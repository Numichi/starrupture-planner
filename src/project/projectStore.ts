/**
 * @module project/projectStore
 *
 * Project store – the state of the player's model and every change to it.
 *
 * Responsibilities:
 *   - holds the project (bases, nodes, links, canvas positions), the active base, the
 *     selection and the current edit target,
 *   - is the ONLY place that mutates the project, so its rules live in one place (e.g. the
 *     1:1 / N:1 cargo pairing rule, cleaning up links on delete),
 *   - persistence: every change is saved to the browser's localStorage (debounced),
 *   - undo / redo: JSON snapshots of the project (Ctrl+Z / Ctrl+Y),
 *   - export / import: a JSON file in the same format,
 *   - copy / paste of nodes with the links between them (Ctrl+C / Ctrl+V).
 *
 * Operations that need the game data or the calculation (build chain, balancing, upgrade,
 * auto layout) live in `composables/useEditorActions.ts`; they call these functions too.
 *
 * The module holds singleton state; components access it through {@link useProject}.
 */
import { computed, ref, shallowRef, watch } from 'vue'

import type { GameData } from '../data/types'
import { sanitizeProject, type LegacyData } from './sanitize'
import {
  PROJECT_VERSION,
  defaultSettings,
  emptyBase,
  linkRailKey,
  newId,
  nodeIds,
  parseNodeId,
  type Base,
  type Dispatcher,
  type Factory,
  type Link,
  type Mine,
  type Point,
  type Project,
  type RailCount,
  type RailLine,
  type RailLink,
  type Receiver,
  type Storage,
} from './types'

/**
 * localStorage key of the saved project. Persisted: changing it loses every saved project
 * (the format version lives inside the JSON, `Project.version`).
 */
const STORAGE_KEY = 'starrupture-planner.project'

/** Name of the first base of a new project. */
const MAIN_BASE_NAME = 'Main base'

/** What is being edited (the editor panel opens for it). */
export type EditTarget =
  | { kind: 'factory' | 'mine' | 'receiver' | 'dispatcher' | 'storage' | 'railLink'; id: string }
  | { kind: 'railLine'; id: string; baseId: string }
  /** A link (clicked edge): flow, rail, distribution, manual rail setting. */
  | { kind: 'link'; id: string; baseId: string }

// ============================================================================
// State
// ============================================================================

const project = ref<Project>({
  version: PROJECT_VERSION,
  name: 'Project',
  bases: [],
  railLinks: [],
  settings: defaultSettings(),
})

const activeBaseId = ref('')
const editing = ref<EditTarget | null>(null)

/** Selected nodes in the active base. */
const selection = ref<string[]>([])

/** Selected link (Delete removes its rail). */
const selectedLink = ref<string | null>(null)

/** Jump to another base / from a list: the node to centre and highlight. */
const focus = ref<{ baseId: string; nodeId: string; at: number } | null>(null)

const projectWarnings = ref<string[]>([])

/** After loading an old (v1) project: factories still have to be built from its targets. */
const pendingLegacy = ref<LegacyData | null>(null)

let initialized = false

/**
 * Cargo pairing rule (`features.cargoManyToOne` in game.yml, set by usePlanner).
 * `false` = 1:1: pairing a new Dispatcher overrides the Receiver's old one, as in the game.
 */
let cargoManyToOne = false

/** Sets the cargo pairing rule from the game data. */
function setCargoRules(rules: { manyToOne: boolean }) {
  cargoManyToOne = rules.manyToOne
}

// ============================================================================
// Loading, saving, export / import
// ============================================================================

/**
 * Initialises the store after the first data load: the saved project, or the start project.
 * Also starts autosave and the undo history. Runs only once.
 */
export function initProject(data: GameData) {
  if (initialized) return

  initialized = true

  let saved: unknown = null

  try {
    const text = localStorage.getItem(STORAGE_KEY)

    if (text) saved = JSON.parse(text)
  } catch {
    // Corrupt or blocked storage → start project.
  }

  setProject(saved ?? startProject(data))

  // Save after every change (300 ms later, so typing does not write continuously).
  let timer: ReturnType<typeof setTimeout> | undefined

  watch(
    project,
    () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(project.value))
        } catch {
          // Full or blocked storage: not fatal, export still works.
        }
      }, 300)
    },
    { deep: true },
  )

  startHistory()
}

/** The start project: the `startProject` file of game.yml, or one base with the default targets (v1 form). */
function startProject(data: GameData): unknown {
  if (data.startProject) return data.startProject

  return {
    version: 1,
    name: 'Project',
    bases: [{ name: MAIN_BASE_NAME, targets: data.defaultTargets }],
    railLinks: [],
  }
}

/** Replaces the whole project (sanitised) and resets the view state. */
function setProject(raw: unknown) {
  const { project: p, warnings, legacy } = sanitizeProject(raw)

  if (p.bases.length === 0) p.bases.push(emptyBase(MAIN_BASE_NAME))

  project.value = p
  projectWarnings.value = warnings
  pendingLegacy.value = legacy
  activeBaseId.value = p.bases[0].id
  editing.value = null
  selection.value = []
  selectedLink.value = null
}

/** New project from the start file (the current one is lost; export it first if needed). */
function resetProject(data: GameData) {
  setProject(startProject(data))
}

/** The project as formatted JSON (for export). */
function exportProject(): string {
  return JSON.stringify(project.value, null, 2)
}

/**
 * Loads a project from JSON text.
 * @throws {SyntaxError} when the text is not valid JSON
 */
function importProject(text: string) {
  setProject(JSON.parse(text))
}

/** Marks the old targets as processed (called by useEditorActions after rebuilding factories). */
function clearLegacy() {
  pendingLegacy.value = null
}

// ============================================================================
// Undo / redo
// ============================================================================
//
// After every user change (debounced by 250 ms, so typing and quick successive changes are
// one step) the project JSON is pushed onto the `past` stack. The app's own automatic
// changes (placing nodes without a position, converting an old project) are NOT separate
// steps (`withoutHistory`): otherwise the app would redo them right after an undo and
// Ctrl+Z would "stick".

const HISTORY_LIMIT = 60
const past: string[] = []
const future: string[] = []
let current = ''
let historyStarted = false
const historyVersion = ref(0)
let historyTimer: ReturnType<typeof setTimeout> | undefined

/** Starts recording snapshots (after the project is loaded). */
function startHistory() {
  current = JSON.stringify(project.value)
  historyStarted = true

  watch(
    project,
    () => {
      clearTimeout(historyTimer)
      historyTimer = setTimeout(recordSnapshot, 250)
    },
    { deep: true },
  )
}

/** Records the pending change as one undo step (no-op when nothing changed). */
function recordSnapshot() {
  clearTimeout(historyTimer)

  if (!historyStarted) return

  const snap = JSON.stringify(project.value)

  if (snap === current) return

  past.push(current)

  if (past.length > HISTORY_LIMIT) past.shift()

  future.length = 0
  current = snap
  historyVersion.value++
}

/**
 * Applies an automatic change that must not be its own undo step: a pending user change is
 * recorded first, then this change merges into the current state (redo is kept).
 */
function withoutHistory(change: () => void) {
  recordSnapshot()
  change()

  if (historyStarted) current = JSON.stringify(project.value)
}

/** Whether the edited element still exists (e.g. in a restored project). */
function editTargetExists(t: EditTarget): boolean {
  switch (t.kind) {
    case 'factory':
      return !!findFactory(t.id)
    case 'mine':
      return !!findMine(t.id)
    case 'receiver':
      return !!findReceiver(t.id)
    case 'dispatcher':
      return !!findDispatcher(t.id)
    case 'storage':
      return !!findStorage(t.id)
    case 'railLink':
      return project.value.railLinks.some((l) => l.id === t.id)
    case 'railLine':
      return !!baseById(t.baseId)?.railLines.some((l) => l.id === t.id)
    case 'link':
      return !!baseById(t.baseId)?.links.some((l) => l.id === t.id)
  }
}

/** Restores a snapshot; the editor stays open while its target still exists. */
function restore(snap: string) {
  current = snap

  const p = JSON.parse(snap) as Project

  project.value = p

  if (!p.bases.some((b) => b.id === activeBaseId.value)) activeBaseId.value = p.bases[0]?.id ?? ''

  if (editing.value && !editTargetExists(editing.value)) editing.value = null

  const base = activeBase()
  const exists = (id: string) =>
    !!base && (base.positions[id] !== undefined || nodeExists(base, id))

  selection.value = selection.value.filter(exists)

  if (selectedLink.value && !base?.links.some((l) => l.id === selectedLink.value))
    selectedLink.value = null

  historyVersion.value++
}

/** Whether the base has such a node (regardless of its position). */
function nodeExists(base: Base, nodeId: string): boolean {
  const { prefix, id } = parseNodeId(nodeId)

  switch (prefix) {
    case 'fac':
      return base.factories.some((x) => x.id === id)
    case 'mine':
      return base.mines.some((x) => x.id === id)
    case 'recv':
      return base.receivers.some((x) => x.id === id)
    case 'disp':
      return base.dispatchers.some((x) => x.id === id)
    case 'store':
      return base.storages.some((x) => x.id === id)
    case 'line':
      return base.railLines.some((x) => x.id === id)
    case 'railin':
    case 'railout':
      return project.value.railLinks.some((l) => l.id === id)
    default:
      return false
  }
}

/** Undoes the last change (Ctrl+Z). */
function undo() {
  recordSnapshot()

  const snap = past.pop()

  if (snap === undefined) return

  future.push(current)
  restore(snap)
}

/** Redoes the last undone change (Ctrl+Y / Ctrl+Shift+Z). */
function redo() {
  recordSnapshot()

  const snap = future.pop()

  if (snap === undefined) return

  past.push(current)
  restore(snap)
}

const canUndo = computed(() => (historyVersion.value, past.length > 0))
const canRedo = computed(() => (historyVersion.value, future.length > 0))

// ============================================================================
// Lookups
// ============================================================================

function baseById(id: string): Base | undefined {
  return project.value.bases.find((b) => b.id === id)
}

function activeBase(): Base | undefined {
  return baseById(activeBaseId.value)
}

/** Finds an entity by id in any base. */
function find<T extends { id: string }>(
  pick: (b: Base) => T[],
  id: string,
): { base: Base; item: T } | null {
  for (const base of project.value.bases) {
    const item = pick(base).find((x) => x.id === id)

    if (item) return { base, item }
  }

  return null
}

const findFactory = (id: string) => {
  const f = find((b) => b.factories, id)

  return f && { base: f.base, factory: f.item }
}

const findMine = (id: string) => {
  const f = find((b) => b.mines, id)

  return f && { base: f.base, mine: f.item }
}

const findReceiver = (id: string) => {
  const f = find((b) => b.receivers, id)

  return f && { base: f.base, receiver: f.item }
}

const findDispatcher = (id: string) => {
  const f = find((b) => b.dispatchers, id)

  return f && { base: f.base, dispatcher: f.item }
}

const findStorage = (id: string) => {
  const f = find((b) => b.storages, id)

  return f && { base: f.base, storage: f.item }
}

/** The Dispatchers sending to this Receiver (N:1: may be several). */
function dispatchersOf(receiverId: string): { base: Base; dispatcher: Dispatcher }[] {
  const result: { base: Base; dispatcher: Dispatcher }[] = []

  for (const base of project.value.bases) {
    for (const dispatcher of base.dispatchers) {
      if (dispatcher.receiverId === receiverId) result.push({ base, dispatcher })
    }
  }

  return result
}

/** The next free numbered name, e.g. "Receiver 3". */
function nextName(prefix: string, existing: string[]): string {
  const used = new Set(existing)
  let n = 1

  while (used.has(`${prefix} ${n}`)) n++

  return `${prefix} ${n}`
}

/** Every name of one entity kind across all bases (names of cargo nodes are project-wide). */
const allNames = (pick: (b: Base) => { name: string }[]) =>
  project.value.bases.flatMap((b) => pick(b).map((x) => x.name))

// ============================================================================
// Bases
// ============================================================================

/** Adds a new base and makes it active. */
function addBase(): Base {
  const base = emptyBase(
    nextName(
      'Base',
      project.value.bases.map((b) => b.name),
    ),
  )

  project.value.bases.push(base)
  setActiveBase(base.id)

  return base
}

function renameBase(id: string, name: string) {
  const base = baseById(id)

  if (base && name.trim()) base.name = name.trim()
}

/** Removes a base with everything attached to it (pairings, inter-base rails). The last base stays. */
function removeBase(id: string) {
  const base = baseById(id)

  if (!base || project.value.bases.length <= 1) return

  const receiverIds = new Set(base.receivers.map((r) => r.id))

  for (const b of project.value.bases) {
    for (const d of b.dispatchers)
      if (d.receiverId && receiverIds.has(d.receiverId)) d.receiverId = null
  }

  for (const l of project.value.railLinks.filter((x) => x.from === id || x.to === id))
    removeRailLinkEnds(l)

  project.value.railLinks = project.value.railLinks.filter((l) => l.from !== id && l.to !== id)
  project.value.bases = project.value.bases.filter((b) => b.id !== id)

  if (activeBaseId.value === id) setActiveBase(project.value.bases[0].id)

  editing.value = null
}

/** Switches to another base (clears the selection and the editor). */
function setActiveBase(id: string) {
  if (!baseById(id)) return

  activeBaseId.value = id
  editing.value = null
  selection.value = []
  selectedLink.value = null
}

// ============================================================================
// Placing nodes (the caller provides the canvas position)
// ============================================================================

function place(base: Base, nodeId: string, at?: Point) {
  if (at) base.positions[nodeId] = { x: Math.round(at.x), y: Math.round(at.y) }
}

/**
 * Adds a factory. It is automatic by default (sized from its inputs); `count` applies until
 * it has a linked input (e.g. a factory sized by the chain builder).
 */
function addFactory(
  baseId: string,
  recipe: string,
  count = 1,
  at?: Point,
  auto = true,
): Factory | null {
  const base = baseById(baseId)

  if (!base) return null

  const factory: Factory = { id: newId('fac'), recipe, count: roundCount(count), auto }

  base.factories.push(factory)
  place(base, nodeIds.factory(factory.id), at)

  return factory
}

function addMine(baseId: string, mine: Omit<Mine, 'id'>, at?: Point): Mine | null {
  const base = baseById(baseId)

  if (!base) return null

  const m: Mine = { id: newId('mine'), ...mine, count: roundCount(mine.count) }

  base.mines.push(m)
  place(base, nodeIds.mine(m.id), at)

  return m
}

function addReceiver(
  baseId: string,
  building: string,
  item: string | null = null,
  at?: Point,
): Receiver | null {
  const base = baseById(baseId)

  if (!base) return null

  const receiver: Receiver = {
    id: newId('rcv'),
    name: nextName(
      'Receiver',
      allNames((b) => b.receivers),
    ),
    building,
    item,
    virtual: null,
  }

  base.receivers.push(receiver)
  place(base, nodeIds.receiver(receiver.id), at)

  return receiver
}

function addDispatcher(
  baseId: string,
  building: string,
  item: string | null = null,
  at?: Point,
): Dispatcher | null {
  const base = baseById(baseId)

  if (!base) return null

  const dispatcher: Dispatcher = {
    id: newId('dsp'),
    name: nextName(
      'Dispatcher',
      allNames((b) => b.dispatchers),
    ),
    building,
    item,
    receiverId: null,
    feedRail: null,
    virtual: null,
  }

  base.dispatchers.push(dispatcher)
  place(base, nodeIds.dispatcher(dispatcher.id), at)

  return dispatcher
}

function addStorage(
  baseId: string,
  building: string,
  item: string | null = null,
  at?: Point,
): Storage | null {
  const base = baseById(baseId)

  if (!base) return null

  const storage: Storage = {
    id: newId('sto'),
    name: nextName(
      'Storage',
      base.storages.map((s) => s.name),
    ),
    building,
    item,
    count: 1,
  }

  base.storages.push(storage)
  place(base, nodeIds.storage(storage.id), at)

  return storage
}

/** Adds an inter-base rail: an outgoing node in the source base, an incoming node in the target base. */
function addRailLink(fromBaseId: string, toBaseId: string, at?: Point): RailLink | null {
  const from = baseById(fromBaseId)
  const to = baseById(toBaseId)

  if (!from || !to || from.id === to.id) return null

  const link: RailLink = {
    id: newId('rl'),
    name: nextName(
      'Inter-base rail',
      project.value.railLinks.map((l) => l.name),
    ),
    from: from.id,
    to: to.id,
    items: [],
  }

  project.value.railLinks.push(link)
  place(from, nodeIds.railOut(link.id), at)

  return link
}

/** Adds a rail line: automatic sizing, dynamic inputs. */
function addRailLine(baseId: string, at?: Point): RailLine | null {
  const base = baseById(baseId)

  if (!base) return null

  const line: RailLine = {
    id: newId('line'),
    name: nextName(
      'Rail line',
      base.railLines.map((l) => l.name),
    ),
    mode: 'auto',
    rails: [{ tier: null, count: 1 }],
    slots: null,
  }

  base.railLines.push(line)
  place(base, nodeIds.line(line.id), at)

  return line
}

/** Machine count with at most 6 decimals (shown rounded; without floating-point noise). */
function roundCount(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 1e6) / 1e6) : 1
}

// ============================================================================
// Updates
// ============================================================================

function updateFactory(id: string, patch: Partial<Omit<Factory, 'id'>>) {
  const found = findFactory(id)

  if (!found) return

  if (patch.count !== undefined) patch.count = roundCount(patch.count)

  Object.assign(found.factory, patch)
}

/**
 * Sets a factory's machine count: `'auto'` = automatic (from its inputs), a number = manual
 * with that count.
 *
 * When switching to manual, the caller passes the currently shown (automatic) count so the
 * number does not jump. Nothing is written when nothing changes (no empty undo step).
 */
function setFactoryCount(id: string, value: number | 'auto') {
  const found = findFactory(id)

  if (!found) return

  const f = found.factory

  if (value === 'auto') {
    if (!f.auto) f.auto = true

    return
  }

  if (!Number.isFinite(value) || value < 0) return

  const count = roundCount(value)

  if (!f.auto && f.count === count) return

  f.auto = false
  f.count = count
}

function updateMine(id: string, patch: Partial<Omit<Mine, 'id'>>) {
  const found = findMine(id)

  if (!found) return

  if (patch.count !== undefined) patch.count = roundCount(patch.count)

  Object.assign(found.mine, patch)
}

/** Updates a Receiver; a new item is passed on to its Dispatchers. */
function updateReceiver(id: string, patch: Partial<Omit<Receiver, 'id'>>) {
  const found = findReceiver(id)

  if (!found) return

  Object.assign(found.receiver, patch)

  if (patch.item !== undefined) {
    for (const d of dispatchersOf(id)) d.dispatcher.item = patch.item
  }
}

/** Updates a Dispatcher; sending a different item unpairs it from a Receiver of another item. */
function updateDispatcher(id: string, patch: Partial<Omit<Dispatcher, 'id' | 'receiverId'>>) {
  const found = findDispatcher(id)

  if (!found) return

  Object.assign(found.dispatcher, patch)

  if (patch.item !== undefined && found.dispatcher.receiverId) {
    const r = findReceiver(found.dispatcher.receiverId)

    if (r && r.receiver.item && r.receiver.item !== patch.item) found.dispatcher.receiverId = null
  }
}

/**
 * Pairs a Dispatcher with a Receiver (a Dispatcher has one Receiver).
 *
 * - 1:1 rule (default): a Receiver's previous Dispatcher loses its pairing (override, as in
 *   the game).
 * - N:1 rule: a Receiver may have several Dispatchers.
 *
 * The Dispatcher adopts the Receiver's item (the Receiver decides what it must receive).
 *
 * @param receiverId the target, or null to unpair
 */
function pair(dispatcherId: string, receiverId: string | null) {
  const found = findDispatcher(dispatcherId)

  if (!found) return

  if (receiverId) {
    if (!cargoManyToOne) {
      for (const other of dispatchersOf(receiverId)) {
        if (other.dispatcher.id !== dispatcherId) other.dispatcher.receiverId = null
      }
    }

    const r = findReceiver(receiverId)

    if (r?.receiver.item) found.dispatcher.item = r.receiver.item
    else if (r && found.dispatcher.item) r.receiver.item = found.dispatcher.item
  }

  found.dispatcher.receiverId = receiverId
}

function updateStorage(id: string, patch: Partial<Omit<Storage, 'id'>>) {
  const found = findStorage(id)

  if (found) Object.assign(found.storage, patch)
}

/**
 * Updates an inter-base rail. Moving an end to another base drops the old end's links and
 * position; removing an item drops the links of that item.
 */
function updateRailLink(id: string, patch: Partial<Omit<RailLink, 'id'>>) {
  const link = project.value.railLinks.find((l) => l.id === id)

  if (!link) return

  const oldTo = link.to
  const oldFrom = link.from

  Object.assign(link, patch)

  if (patch.to !== undefined && patch.to !== oldTo)
    dropNodeRefs(baseById(oldTo), nodeIds.railIn(id))
  if (patch.from !== undefined && patch.from !== oldFrom)
    dropNodeRefs(baseById(oldFrom), nodeIds.railOut(id))

  if (patch.items !== undefined) {
    const ends = [
      [link.from, nodeIds.railOut(id)],
      [link.to, nodeIds.railIn(id)],
    ] as const

    for (const [baseId, nodeId] of ends) {
      const base = baseById(baseId)

      if (base) {
        base.links = base.links.filter(
          (l) => !((l.from === nodeId || l.to === nodeId) && !link.items.includes(l.item)),
        )
      }
    }
  }
}

// ============================================================================
// Links
// ============================================================================

/**
 * Links the output of `from` to the input of `to` for one item (in the same base).
 *
 * A node without an item yet (Dispatcher, storage, Receiver) adopts the linked item; an
 * inter-base rail adds it to its item list. All links between the same two nodes share one
 * rail, so a new link copies a sibling's manual rail setting.
 *
 * @returns the new (or already existing) link, or null when it cannot be linked
 */
function addLink(baseId: string, from: string, to: string, item: string): Link | null {
  const base = baseById(baseId)

  if (!base || from === to) return null

  const existing = base.links.find((l) => l.from === from && l.to === to && l.item === item)

  if (existing) return existing

  adoptItem(from, item)
  adoptItem(to, item)

  const link: Link = { id: newId('lnk'), from, to, item }
  const sibling = base.links.find((l) => l.from === from && l.to === to && l.rail)

  if (sibling?.rail?.length) link.rail = sibling.rail.map((r) => ({ ...r }))

  base.links.push(link)

  return link
}

/** A node without an item adopts the linked item. */
function adoptItem(nodeId: string, item: string) {
  const { prefix, id } = parseNodeId(nodeId)

  if (prefix === 'disp') {
    const d = findDispatcher(id)?.dispatcher

    if (d && !d.item) updateDispatcher(id, { item })
  } else if (prefix === 'store') {
    const s = findStorage(id)?.storage

    if (s && !s.item) s.item = item
  } else if (prefix === 'recv') {
    const r = findReceiver(id)?.receiver

    if (r && !r.item) updateReceiver(id, { item })
  } else if (prefix === 'railout' || prefix === 'railin') {
    const l = project.value.railLinks.find((x) => x.id === id)

    if (l && !l.items.includes(item)) l.items.push(item)
  }
}

/**
 * Normalises a rail set: whole counts ≥ 1, equal tiers merged, zero rows dropped.
 * An empty result means "no manual rail".
 */
function cleanRails(rails: readonly RailCount[]): RailCount[] {
  const out: RailCount[] = []

  for (const r of rails) {
    const count = Math.round(Number(r.count) || 0)

    if (count < 1) continue

    const same = out.find((x) => x.tier === r.tier)

    if (same) same.count += count
    else out.push({ tier: r.tier, count })
  }

  return out
}

/**
 * Sets the rail of a link: a manual rail set (count per tier, mixed allowed) or null =
 * automatic. The rail belongs to every link between the same two nodes (several items on
 * one rail), so all of them get it.
 */
function setLinkRail(baseId: string, linkId: string, rails: readonly RailCount[] | null) {
  const base = baseById(baseId)
  const link = base?.links.find((l) => l.id === linkId)

  if (!base || !link) return

  const key = linkRailKey(link)
  const clean = rails ? cleanRails(rails) : []

  for (const l of base.links) {
    if (linkRailKey(l) !== key) continue

    if (!clean.length) delete l.rail
    else l.rail = clean.map((r) => ({ ...r }))
  }
}

/** Removes a rail: every link between the same two nodes (one drawn line). */
function removeRail(baseId: string, linkId: string) {
  const base = baseById(baseId)
  const link = base?.links.find((l) => l.id === linkId)

  if (!base || !link) return

  const key = linkRailKey(link)
  const ids = new Set(base.links.filter((l) => linkRailKey(l) === key).map((l) => l.id))

  base.links = base.links.filter((l) => !ids.has(l.id))

  if (selectedLink.value && ids.has(selectedLink.value)) selectedLink.value = null
  if (editing.value?.kind === 'link' && ids.has(editing.value.id)) editing.value = null
}

/** Removes one link (one item of a rail). */
function removeLink(baseId: string, linkId: string) {
  const base = baseById(baseId)

  if (!base) return

  base.links = base.links.filter((l) => l.id !== linkId)

  if (selectedLink.value === linkId) selectedLink.value = null
  if (editing.value?.kind === 'link' && editing.value.id === linkId) editing.value = null
}

/** Removes the links of a node (optionally only those matching `filter`). */
function removeLinksOf(baseId: string, nodeId: string, filter?: (l: Link) => boolean) {
  const base = baseById(baseId)

  if (!base) return

  base.links = base.links.filter(
    (l) => !((l.from === nodeId || l.to === nodeId) && (!filter || filter(l))),
  )
}

// ============================================================================
// Delete, move, counts
// ============================================================================

/** Drops the links to a node and its position from one base. */
function dropNodeRefs(base: Base | undefined, nodeId: string) {
  if (!base) return

  base.links = base.links.filter((l) => l.from !== nodeId && l.to !== nodeId)
  delete base.positions[nodeId]
}

/** Drops both ends of an inter-base rail (links and positions). */
function removeRailLinkEnds(link: RailLink) {
  dropNodeRefs(baseById(link.from), nodeIds.railOut(link.id))
  dropNodeRefs(baseById(link.to), nodeIds.railIn(link.id))
}

/** Removes nodes together with their links and cargo pairings. */
function removeNodes(baseId: string, ids: readonly string[]) {
  const base = baseById(baseId)

  if (!base) return

  for (const nodeId of ids) {
    const { prefix, id } = parseNodeId(nodeId)

    switch (prefix) {
      case 'fac':
        base.factories = base.factories.filter((x) => x.id !== id)
        break
      case 'mine':
        base.mines = base.mines.filter((x) => x.id !== id)
        break
      case 'recv':
        for (const d of dispatchersOf(id)) d.dispatcher.receiverId = null
        base.receivers = base.receivers.filter((x) => x.id !== id)
        break
      case 'disp':
        base.dispatchers = base.dispatchers.filter((x) => x.id !== id)
        break
      case 'store':
        base.storages = base.storages.filter((x) => x.id !== id)
        break
      case 'railin':
      case 'railout': {
        const link = project.value.railLinks.find((l) => l.id === id)

        if (link) removeRailLinkEnds(link)

        project.value.railLinks = project.value.railLinks.filter((l) => l.id !== id)
        break
      }
      case 'line':
        base.railLines = base.railLines.filter((l) => l.id !== id)
        break
    }

    dropNodeRefs(base, nodeId)

    if (editing.value && 'id' in editing.value && editing.value.id === id) editing.value = null
  }

  selection.value = selection.value.filter((x) => !ids.includes(x))
}

/** Sets node positions (end of a drag, auto layout). */
function setPositions(
  baseId: string,
  positions: ReadonlyMap<string, Point> | Record<string, Point>,
) {
  const base = baseById(baseId)

  if (!base) return

  const entries = positions instanceof Map ? [...positions] : Object.entries(positions)

  for (const [id, p] of entries) base.positions[id] = { x: Math.round(p.x), y: Math.round(p.y) }
}

/** Moves nodes by an offset. */
function moveNodes(baseId: string, ids: readonly string[], dx: number, dy: number) {
  const base = baseById(baseId)

  if (!base || (!dx && !dy)) return

  for (const id of ids) {
    const p = base.positions[id]

    if (p) base.positions[id] = { x: Math.round(p.x + dx), y: Math.round(p.y + dy) }
  }
}

/** Sets machine counts (balancing): node id → count. */
function setCounts(counts: ReadonlyMap<string, number>) {
  for (const [nodeId, count] of counts) {
    const { prefix, id } = parseNodeId(nodeId)

    if (prefix === 'fac') updateFactory(id, { count })
    else if (prefix === 'mine') updateMine(id, { count })
  }
}

// ============================================================================
// Rail lines
// ============================================================================

function findLine(baseId: string, lineId: string) {
  return baseById(baseId)?.railLines.find((l) => l.id === lineId)
}

/**
 * Updates a rail line. Rail set counts are whole numbers ≥ 1 (zero rows are dropped, but at
 * least one rail remains); the input count is at least 1 or null (dynamic).
 */
function updateRailLine(baseId: string, lineId: string, patch: Partial<Omit<RailLine, 'id'>>) {
  const line = findLine(baseId, lineId)

  if (!line) return

  const p = { ...patch }

  if (p.rails !== undefined) {
    const clean = cleanRails(p.rails)

    p.rails = clean.length ? clean : [{ tier: null, count: 1 }]
  }

  if (p.slots !== undefined && p.slots !== null)
    p.slots = Math.max(1, Math.round(Number(p.slots) || 1))

  Object.assign(line, p)
}

/**
 * Sets the manual cycle time (seconds) of a recipe without a rate; null or 0 removes it.
 * It applies only while the data has no reliable rate (`engine/missingData.ts`).
 */
function setCycleTime(recipeId: string, seconds: number | null) {
  const map = project.value.settings.cycleTimes

  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) delete map[recipeId]
  else map[recipeId] = Math.round(seconds * 1000) / 1000
}

/** The items of a rail line in link order (inputs and outputs alike). */
function lineItems(baseId: string, lineId: string): string[] {
  const id = nodeIds.line(lineId)

  return [
    ...new Set(
      (baseById(baseId)?.links ?? [])
        .filter((l) => l.to === id || l.from === id)
        .map((l) => l.item),
    ),
  ]
}

// ============================================================================
// Copy / paste (Ctrl+C / Ctrl+V)
// ============================================================================

/** The clipboard: copied nodes (deep copies), the links between them and their positions. */
interface Clipboard {
  factories: Factory[]
  mines: Mine[]
  receivers: Receiver[]
  dispatchers: Dispatcher[]
  storages: Storage[]
  railLines: RailLine[]

  /** Only the links BETWEEN the copied nodes. */
  links: Link[]

  /** Old node id → canvas position (top-left corner). */
  positions: Record<string, Point>

  /** How many times it was pasted (without a pointer position the copy shifts that many times). */
  pasted: number
}

type CopyKey = 'factories' | 'mines' | 'receivers' | 'dispatchers' | 'storages' | 'railLines'

/** Node prefix → the base list. Inter-base rail ends (railin / railout) cannot be copied. */
const COPYABLE: Record<string, CopyKey> = {
  fac: 'factories',
  mine: 'mines',
  recv: 'receivers',
  disp: 'dispatchers',
  store: 'storages',
  line: 'railLines',
}

const clipboard = shallowRef<Clipboard | null>(null)

/** Offset of a pasted copy without a pointer position (px). */
const PASTE_OFFSET = 48

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/**
 * Name of a copy: "Receiver 3" → the next free "Receiver n";
 * "R-Titanium Ore" → "R-Titanium Ore (2)" (the next free number).
 */
function copyName(name: string, existing: string[]): string {
  const numbered = /^(.*\S) (\d+)$/.exec(name)

  if (numbered) return nextName(numbered[1], existing)

  const used = new Set(existing)
  const stem = name.replace(/ \(\d+\)$/, '')
  let n = 2

  while (used.has(`${stem} (${n})`)) n++

  return `${stem} (${n})`
}

/**
 * Copies nodes to the clipboard together with the links between them.
 * Inter-base rail ends are skipped (a rail has exactly one outgoing and one incoming end).
 *
 * @param positions canvas positions of the nodes (including auto-placed ones); defaults to the stored positions
 * @returns how many nodes and links were copied and how many nodes were skipped
 */
function copyNodes(baseId: string, ids: readonly string[], positions?: ReadonlyMap<string, Point>) {
  const result = { nodes: 0, links: 0, skipped: 0 }
  const base = baseById(baseId)

  if (!base) return result

  const clip: Clipboard = {
    factories: [],
    mines: [],
    receivers: [],
    dispatchers: [],
    storages: [],
    railLines: [],
    links: [],
    positions: {},
    pasted: 0,
  }
  const copied = new Set<string>()

  for (const nodeId of ids) {
    const { prefix, id } = parseNodeId(nodeId)
    const key = COPYABLE[prefix]
    const entity = key && (base[key] as { id: string }[]).find((x) => x.id === id)

    if (!entity) {
      result.skipped++
      continue
    }

    ;(clip[key] as { id: string }[]).push(clone(entity))
    copied.add(nodeId)

    const p = positions?.get(nodeId) ?? base.positions[nodeId]

    if (p) clip.positions[nodeId] = { x: p.x, y: p.y }
  }

  if (!copied.size) return result

  clip.links = base.links.filter((l) => copied.has(l.from) && copied.has(l.to)).map(clone)
  clipboard.value = clip

  return { nodes: copied.size, links: clip.links.length, skipped: result.skipped }
}

/**
 * Pastes the clipboard into a base (it may be another base): new ids, new names (Receiver /
 * Dispatcher names are unique, pairing is by name) and links between the new nodes.
 *
 * A Dispatcher keeps its pairing only when its Receiver was copied with it (otherwise, under
 * the 1:1 rule, it would take over the original pairing). The new nodes stay selected.
 *
 * @param at top-left corner of the pasted group; without it the copy is offset from the original
 * @returns the new node ids and the number of links
 */
function pasteNodes(baseId: string, at?: Point): { ids: string[]; links: number } {
  const base = baseById(baseId)
  const clip = clipboard.value

  if (!base || !clip) return { ids: [], links: 0 }

  /** Old node id → new node id. */
  const map = new Map<string, string>()
  const receiverIds = new Map<string, string>()

  for (const r of clip.receivers) {
    const n: Receiver = {
      ...clone(r),
      id: newId('rcv'),
      name: copyName(
        r.name,
        allNames((b) => b.receivers),
      ),
    }

    base.receivers.push(n)
    receiverIds.set(r.id, n.id)
    map.set(nodeIds.receiver(r.id), nodeIds.receiver(n.id))
  }

  for (const d of clip.dispatchers) {
    const n: Dispatcher = {
      ...clone(d),
      id: newId('dsp'),
      name: copyName(
        d.name,
        allNames((b) => b.dispatchers),
      ),
      receiverId: d.receiverId ? (receiverIds.get(d.receiverId) ?? null) : null,
    }

    base.dispatchers.push(n)
    map.set(nodeIds.dispatcher(d.id), nodeIds.dispatcher(n.id))
  }

  for (const f of clip.factories) {
    const n: Factory = { ...clone(f), id: newId('fac') }

    base.factories.push(n)
    map.set(nodeIds.factory(f.id), nodeIds.factory(n.id))
  }

  for (const m of clip.mines) {
    const n: Mine = { ...clone(m), id: newId('mine') }

    base.mines.push(n)
    map.set(nodeIds.mine(m.id), nodeIds.mine(n.id))
  }

  for (const s of clip.storages) {
    const n: Storage = {
      ...clone(s),
      id: newId('sto'),
      name: copyName(
        s.name,
        base.storages.map((x) => x.name),
      ),
    }

    base.storages.push(n)
    map.set(nodeIds.storage(s.id), nodeIds.storage(n.id))
  }

  for (const l of clip.railLines) {
    const n: RailLine = {
      ...clone(l),
      id: newId('line'),
      name: copyName(
        l.name,
        base.railLines.map((x) => x.name),
      ),
    }

    base.railLines.push(n)
    map.set(nodeIds.line(l.id), nodeIds.line(n.id))
  }

  let links = 0

  for (const l of clip.links) {
    const from = map.get(l.from)
    const to = map.get(l.to)

    if (!from || !to) continue

    base.links.push({ ...clone(l), id: newId('lnk'), from, to })
    links++
  }

  // Position: the group's top-left corner at the pointer, or offset from the original.
  const pts = Object.values(clip.positions)

  clip.pasted++

  if (pts.length) {
    const minX = Math.min(...pts.map((p) => p.x))
    const minY = Math.min(...pts.map((p) => p.y))
    const dx = at ? at.x - minX : PASTE_OFFSET * clip.pasted
    const dy = at ? at.y - minY : PASTE_OFFSET * clip.pasted

    for (const [oldId, p] of Object.entries(clip.positions)) {
      const newNodeId = map.get(oldId)

      if (newNodeId)
        base.positions[newNodeId] = { x: Math.round(p.x + dx), y: Math.round(p.y + dy) }
    }
  }

  const ids = [...map.values()]

  selection.value = ids
  selectedLink.value = null
  editing.value = null

  return { ids, links }
}

// ============================================================================
// Selection, navigation, editor
// ============================================================================

/** Selects nodes (additive: adds to the current selection). */
function select(ids: string[], additive = false) {
  selection.value = additive ? [...new Set([...selection.value, ...ids])] : [...ids]
  selectedLink.value = null
}

/** The editor that belongs to a node. */
function editTargetOf(nodeId: string): EditTarget | null {
  const { prefix, id } = parseNodeId(nodeId)

  switch (prefix) {
    case 'fac':
      return { kind: 'factory', id }
    case 'mine':
      return { kind: 'mine', id }
    case 'recv':
      return { kind: 'receiver', id }
    case 'disp':
      return { kind: 'dispatcher', id }
    case 'store':
      return { kind: 'storage', id }
    case 'railin':
    case 'railout':
      return { kind: 'railLink', id }
    case 'line':
      return { kind: 'railLine', id, baseId: activeBaseId.value }
    default:
      return null
  }
}

/** Switches to a base (or stays) and centres and highlights a node there. */
function goTo(baseId: string, nodeId: string) {
  if (baseId !== activeBaseId.value) setActiveBase(baseId)

  selection.value = [nodeId]
  focus.value = { baseId, nodeId, at: Date.now() }
}

/** Access to the project store (state and all mutations). */
export function useProject() {
  return {
    project,
    activeBaseId,
    editing,
    selection,
    selectedLink,
    focus,
    projectWarnings,
    pendingLegacy,
    setCargoRules,
    resetProject,
    exportProject,
    importProject,
    clearLegacy,
    undo,
    redo,
    canUndo,
    canRedo,
    withoutHistory,
    baseById,
    activeBase,
    findFactory,
    findMine,
    findReceiver,
    findDispatcher,
    findStorage,
    dispatchersOf,
    addBase,
    renameBase,
    removeBase,
    setActiveBase,
    addFactory,
    addMine,
    addReceiver,
    addDispatcher,
    addStorage,
    addRailLink,
    addRailLine,
    updateFactory,
    setFactoryCount,
    updateMine,
    updateReceiver,
    updateDispatcher,
    pair,
    updateStorage,
    updateRailLink,
    addLink,
    removeLink,
    removeRail,
    removeLinksOf,
    setLinkRail,
    removeNodes,
    setPositions,
    moveNodes,
    setCounts,
    updateRailLine,
    lineItems,
    setCycleTime,
    clipboard,
    copyNodes,
    pasteNodes,
    select,
    editTargetOf,
    goTo,
  }
}
