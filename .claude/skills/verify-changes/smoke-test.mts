/**
 * SMOKE TEST – a quick engine check without a browser.
 *
 * Run from the project root:
 *   npm run smoke   (= tsx .claude/skills/verify-changes/smoke-test.mts)
 *
 * What it checks:
 *   1. Loading the public/data/ files (data/loader.ts): there must be no warnings.
 *   2. Reading the start project (start-project.json) via project/sanitize.ts:
 *      it must be a current (v2) project, without warnings.
 *   3. The model (engine/projectModel.ts) and the flow LP (engine/flow.ts):
 *      no invalid links, the LP is solved.
 *   4. Per base, the plan (engine/plan.ts): every node has a size
 *      (nodeGeometry.ts KIND_SPEC), every node has a stored position, the
 *      edges are routed (engine/layout.ts) and the ELK auto layout runs.
 *   5. "Build chain" (engine/chain.ts) for every product of the start project,
 *      and balancing (flow.ts with adjustable counts) for the whole project.
 *   6. Rail line: a manual v.1 line is capped at its capacity and reports
 *      congestion (lineDemand), an auto line carries everything (parallel
 *      rails when needed), a fixed input count rejects a new item, and an old
 *      stop-based line is converted to links through the line (sanitize.ts).
 *   7. Effective output: a short factory runs at its bottleneck ratio, the reduced
 *      output becomes a shortage on the next input, only the bottleneck input of a
 *      two-input factory is short, and unlinked inputs count as supplied.
 *   8. Recipes without cycle time (YAML perCycle): 0-rate ports, a manual cycle
 *      time from the project gives the per-minute rate, the chain builder does not
 *      use them, sanitize keeps valid manual values.
 *
 *   9. Link rail (Link.rail): auto picks parallel rails without error, a manual rail
 *      caps the flow and reports congestion (railDemand) and the bottleneck input,
 *      enough manual capacity is not congested; the rail distribution (even / fill).
 *  10. One rail for several items between two nodes (rail line → two-input factory):
 *      capacity on the total; storage balanced / positive (also with a small
 *      outgoing rail); a Dispatcher's automatic feed rail follows its link's manual rail.
 *  11. Copy / paste (projectStore): links between copied nodes, unique names,
 *      Dispatcher–Receiver pair remapped, positions, selection.
 *  12. Even distribution (features.flowDistribution 'even'): two sources share a
 *      consumer equally, a source shared by three consumers splits into thirds;
 *      the 'optimal' switch; an old shared rail (bus) becomes an auto rail line.
 *  13. Undo / redo (projectStore): one step per change, an automatic placement
 *      (withoutHistory) is not a separate step.
 *  14. Automatic machine count (Factory.auto, projectModel › buildSizedModel): an auto
 *      factory takes what reaches its linked inputs (next to a manual one), rounds up
 *      (X full + 1), the next auto factory follows; rounding is not a shortage; no
 *      linked input = the stored count; an exact fit stays at 100%; nothing arriving =
 *      1 machine with a shortage; sanitize defaults to auto.
 *  Also: mixed manual rail sets (2× v.1 + v.3) and the auto rail set (best tiers
 *  full + the smallest tier for the rest) in section 6.
 *
 * Exit code: 0 = OK, 1 = failure. Shortages / surplus are informational only.
 * fetch is replaced: files are read from the public/ folder.
 * Loader warnings and graph warnings are printed as the app produces them (Hungarian).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const PUBLIC = resolve(ROOT, 'public')
const load = (rel: string) => import(pathToFileURL(resolve(ROOT, rel)).href)

;(globalThis as { fetch: unknown }).fetch = async (url: string) => {
  const path = String(url)
    .replace(/^.*?((?:data|icons)\/)/, '$1')
    .replace(/\?.*$/, '')
  try {
    const text = readFileSync(resolve(PUBLIC, path), 'utf8')
    const type = path.endsWith('.svg')
      ? 'image/svg+xml'
      : path.startsWith('icons/')
        ? 'image/png'
        : 'text/yaml'
    return { ok: true, headers: { get: () => type }, text: async () => text }
  } catch {
    return { ok: false, headers: { get: () => 'text/html' }, text: async () => '' }
  }
}

let failed = false
const fail = (msg: string) => {
  failed = true
  console.log(`  ERROR: ${msg}`)
}

const { loadGameData, checkIcons } = await load('src/data/loader.ts')
const { createGameIndex } = await load('src/engine/gameIndex.ts')
const { sanitizeProject } = await load('src/project/sanitize.ts')
const { buildModel, isChainEnd } = {
  ...(await load('src/engine/projectModel.ts')),
  ...(await load('src/engine/flow.ts')),
}
const { solveFlows } = await load('src/engine/flow.ts')
const { buildBasePlan } = await load('src/engine/plan.ts')
const { nodeSize } = await load('src/engine/nodeGeometry.ts')
const { positionGraph, autoLayout } = await load('src/engine/layout.ts')
const { planChain } = await load('src/engine/chain.ts')

// --- 1. Data files ---
console.log('1. Loading data files')
const { data, warnings } = await loadGameData(0)
console.log(
  `  ${data.items.length} items, ${data.buildings.length} buildings, ${data.recipes.length} recipe variants, ` +
    `${data.rails.length} rail tiers, ${data.purities.length} purities`,
)
for (const w of warnings) fail(`data file: ${w}`)
for (const w of await checkIcons(data)) fail(w)

// --- 2. Start project ---
console.log('2. Start project')
const index = createGameIndex(data)
const raw = data.startProject ?? {
  version: 1,
  name: 'Project',
  bases: [{ name: 'Main base', targets: data.defaultTargets }],
}
const { project, warnings: projectWarnings, legacy } = sanitizeProject(raw)
for (const w of projectWarnings) fail(`project: ${w}`)
if (legacy)
  fail(
    'start-project.json is an old (v1) project; save it again from the app (Export) in the current format',
  )
console.log(`  ${project.bases.length} bases, ${project.railLinks.length} inter-base rails`)

// --- 3. Model and flows ---
console.log('3. Model and flow LP')
const cargo = { manyToOne: data.features.cargoManyToOne }
const model = buildModel(index, project, data.rails, cargo)
for (const [id, why] of model.invalidLinks) fail(`invalid link ${id}: ${why}`)
const flow = solveFlows(model)
console.log(
  `  ${model.nodes.size} nodes, ${model.links.length} links, ${model.transfers.length} transfers – ${flow.status}`,
)
if (flow.status !== 'optimal') fail(`flow: ${flow.message}`)

// --- 4. Base plans, positions, routing, ELK ---
console.log('4. Base plans, positions and layout')
const fmt = (list: { item: string; rate: number }[]) =>
  list.map((r) => `${r.item} ${r.rate.toFixed(1)}`).join(', ')
for (const base of project.bases) {
  const plan = buildBasePlan(index, project, model, flow, base.id, { rails: data.rails, cargo })
  const s = plan.summary
  console.log(
    `  ${base.name}: ${plan.status}, ${plan.nodes.length} nodes, ${plan.edges.length} edges, ` +
      `${s.totalRounded} buildings, ${s.totalPower.toFixed(1)} MW`,
  )
  if (plan.status === 'error') fail(`${base.name}: ${plan.message}`)
  for (const n of plan.nodes) {
    try {
      const size = nodeSize(n)
      if (!(size.width > 0 && size.height > 0))
        fail(`${base.name}: node kind "${n.kind}" has no size`)
    } catch {
      fail(`${base.name}: node kind "${n.kind}" is missing from KIND_SPEC in nodeGeometry.ts`)
    }
    if (n.warning) console.log(`    graph warning – ${n.title}: ${n.warning}`)
  }
  if (s.products.length) console.log(`    Products (info): ${fmt(s.products)}`)
  if (s.shortages.length)
    console.log(
      `    Shortages (info): ${s.shortages.map((x: { title: string; item: string; rate: number }) => `${x.title}/${x.item} ${x.rate.toFixed(1)}`).join(', ')}`,
    )
  if (s.surplus.length) console.log(`    Surplus (info): ${fmt(s.surplus)}`)
  const layout = positionGraph(plan, base.positions)
  if (layout.missing.length)
    fail(`${base.name}: nodes without a stored position: ${layout.missing.join(', ')}`)
  if (layout.edges.length !== plan.edges.length)
    fail(`${base.name}: some edges could not be routed`)
  if (plan.nodes.length) {
    try {
      const pos = await autoLayout(plan.nodes, plan.edges, { layerSpacing: 110, nodeSpacing: 36 })
      if (pos.size !== plan.nodes.length) fail(`${base.name}: nodes missing from the ELK layout`)
    } catch (e) {
      fail(`${base.name}: ELK layout error: ${e}`)
    }
  }
}

// --- 5. Build chain, balance ---
console.log('5. Build chain and balance')
const enabled = new Set<string>(
  data.recipes
    .filter((r: { disabledByDefault?: boolean }) => !r.disabledByDefault)
    .map((r: { id: string }) => r.id),
)
const products = new Set<string>()
for (const base of project.bases)
  for (const f of base.factories) {
    const r = index.recipe(f.recipe)
    if (r) products.add(r.product)
  }
for (const item of products) {
  const chain = planChain(index, [{ item, rate: 20, consumer: null }], {
    enabledRecipes: enabled,
    objective: 'buildings',
  })
  if (chain.status !== 'optimal') fail(`chain ${item}: ${chain.message}`)
  else if (chain.missing.length)
    console.log(`  chain ${item}: no source for ${fmt(chain.missing)} (info)`)
}
console.log(`  chain built for ${products.size} products`)
const adjustable = new Set<string>(
  [...model.nodes.values()]
    .filter((n: { kind: string }) => n.kind === 'factory' || n.kind === 'mine')
    .filter((n: unknown) => !isChainEnd(model, n))
    .map((n: { id: string }) => n.id),
)
const balanced = solveFlows(model, adjustable)
console.log(`  balance of ${adjustable.size} nodes: ${balanced.status}`)
if (balanced.status !== 'optimal') fail(`balance: ${balanced.message}`)

// --- 6. Rail line: capacity, congestion, auto scaling, old stops ---
console.log('6. Rail line (capacity, congestion, auto scaling, old stops)')
{
  // Mine (600/min titanium_ore, custom output) → rail line → 10 smelters (600/min demand).
  const lineBase = (mode: string, extra: Record<string, unknown> = {}) => ({
    version: 2,
    name: 'Line test',
    bases: [
      {
        id: 'b',
        name: 'B',
        factories: [{ id: 'f', recipe: 'titanium_bar_smelter', count: 10 }],
        mines: [
          {
            id: 'm',
            building: 'ore_excavator',
            item: 'titanium_ore',
            purity: 'normal',
            count: 1,
            output: 600,
          },
        ],
        railLines: [{ id: 'l', name: 'L', mode, tier: 'v.1', parallel: 1, slots: null, ...extra }],
        links: [
          { id: 'a', from: 'mine:m', to: 'line:l', item: 'titanium_ore' },
          { id: 'c', from: 'line:l', to: 'fac:f', item: 'titanium_ore' },
        ],
        positions: {},
      },
    ],
    railLinks: [],
  })
  const run = (raw: unknown) => {
    const p = sanitizeProject(raw).project
    const m = buildModel(index, p, data.rails, cargo)
    const f = solveFlows(m)
    return { p, plan: buildBasePlan(index, p, m, f, 'b', { rails: data.rails, cargo }) }
  }
  if (!index.recipe('titanium_bar_smelter') || !index.hasBuilding('ore_excavator')) {
    console.log('  skipped (titanium_bar_smelter / ore_excavator not in the data)')
  } else {
    const manual = run(lineBase('manual')).plan
    const ml = manual.nodes.find((n: { id: string }) => n.id === 'line:l')
    const mi = ml?.special
    console.log(
      `  manual v.1: flow ${mi?.total} / ${mi?.rail?.capacity}, would carry ${mi?.demand}, congested ${mi?.congested}`,
    )
    if (!mi || Math.abs(mi.total - (mi.rail?.capacity ?? 0)) > 1e-6)
      fail('manual rail line: flow should be capped at capacity')
    if (!mi?.congested || Math.abs(mi.demand - 600) > 1e-3)
      fail('manual rail line: congestion (demand 600) not detected')
    if (manual.summary.congested !== 1) fail('summary.congested should be 1')
    const auto = run(lineBase('auto')).plan
    const ai = auto.nodes.find((n: { id: string }) => n.id === 'line:l')?.special
    const best = data.rails.at(-1)
    const { railLabel, partsLabel, autoParts, partsCapacity } = await load('src/engine/rails.ts')
    console.log(`  auto: flow ${ai?.total}, rail ${ai?.rail ? railLabel(ai.rail) : '-'}`)
    if (!ai || Math.abs(ai.total - 600) > 1e-3 || ai.congested)
      fail('auto rail line: should carry all 600 without congestion')
    if (
      best &&
      ai?.rail &&
      (ai.rail.count !== Math.ceil(600 / best.capacity - 1e-9) || ai.rail.capacity + 1e-9 < 600)
    )
      fail('auto rail line: wrong rails')
    // Automatic rail set: as many of the best as go full, the smallest that carries the remainder.
    const ap = autoParts(600, data.rails)
    if (
      best &&
      best.capacity < 600 &&
      (partsCapacity(ap) + 1e-9 < 600 ||
        ap.reduce((a: number, x: { count: number }) => a + x.count, 0) !==
          Math.ceil(600 / best.capacity))
    ) {
      fail(`auto rail parts for 600: ${partsLabel(ap)}`)
    }
    // Mixed manual rail set on the rail line (2× v.1 + 1× v.3): capacity = the sum.
    const mixed = run(
      lineBase('manual', {
        rails: [
          { tier: data.rails[0].name, count: 2 },
          { tier: best.name, count: 1 },
        ],
      }),
    ).plan.nodes.find((n: { id: string }) => n.id === 'line:l')?.special
    const mixedCap = 2 * data.rails[0].capacity + best.capacity
    console.log(
      `  manual mixed: ${mixed?.rail ? railLabel(mixed.rail) : '-'} = ${mixed?.rail?.capacity}, flow ${mixed?.total}`,
    )
    if (
      Math.abs((mixed?.rail?.capacity ?? 0) - mixedCap) > 1e-9 ||
      Math.abs((mixed?.total ?? 0) - Math.min(600, mixedCap)) > 1e-6
    )
      fail('mixed manual rails: capacity should be the sum')
    // Fixed input count: the second item no longer fits.
    const slots = run(lineBase('auto', { slots: 1 }))
    const node = buildModel(index, slots.p, data.rails, cargo).nodes.get('line:l')
    const { canAcceptInput } = await load('src/engine/projectModel.ts')
    if (canAcceptInput(node, 'wolfram_ore'))
      fail('rail line with 1 slot should not accept a second item')
    // Old rail line with stops → linking through the line.
    const old = lineBase('auto') as Record<string, any>
    old.bases[0].railLines = [
      {
        id: 'l',
        name: 'Old',
        tier: 'v.2',
        parallel: 1,
        stops: [
          { id: 's1', nodeId: 'mine:m' },
          { id: 's2', nodeId: 'fac:f' },
        ],
      },
    ]
    old.bases[0].links = [{ id: 'd', from: 'mine:m', to: 'fac:f', item: 'titanium_ore' }]
    const migrated = sanitizeProject(old).project.bases[0]
    const pairs = migrated.links
      .map((l: { from: string; to: string }) => `${l.from}>${l.to}`)
      .sort()
      .join(' ')
    console.log(`  old stops → ${pairs}; mode ${migrated.railLines[0].mode}`)
    if (pairs !== 'line:l>fac:f mine:m>line:l' || migrated.railLines[0].mode !== 'manual')
      fail('old rail line stops were not converted to links through the line')
  }
}

// --- 7. Effective output: shortage → less output → shortage downstream ---
console.log('7. Effective output (shortage cascades, bottleneck input)')
if (
  ['titanium_bar_smelter', 'titanium_rod_fabricator', 'basic_building_material_fabricator'].every(
    (r) => index.recipe(r),
  ) &&
  index.hasBuilding('ore_excavator')
) {
  const mine = (id: string, item: string, output: number) => ({
    id,
    building: 'ore_excavator',
    item,
    purity: 'normal',
    count: 1,
    output,
  })
  const raw = {
    version: 2,
    name: 'Effective test',
    bases: [
      {
        id: 'b',
        name: 'B',
        factories: [
          { id: 's', recipe: 'titanium_bar_smelter', count: 1 },
          { id: 'r', recipe: 'titanium_rod_fabricator', count: 1 },
          { id: 'bbm', recipe: 'basic_building_material_fabricator', count: 1 },
        ],
        mines: [
          mine('ti', 'titanium_ore', 30),
          mine('ti2', 'titanium_ore', 15),
          mine('wo', 'wolfram_ore', 60),
        ],
        links: [
          { id: 'l1', from: 'mine:ti', to: 'fac:s', item: 'titanium_ore' },
          { id: 'l2', from: 'fac:s', to: 'fac:r', item: 'titanium_bar' },
          { id: 'l3', from: 'mine:ti2', to: 'fac:bbm', item: 'titanium_ore' },
          { id: 'l4', from: 'mine:wo', to: 'fac:bbm', item: 'wolfram_ore' },
        ],
        positions: {},
      },
    ],
    railLinks: [],
  }
  const p = sanitizeProject(raw).project
  const m = buildModel(index, p, data.rails, cargo)
  const f = solveFlows(m)
  const plan = buildBasePlan(index, p, m, f, 'b', { rails: data.rails, cargo })
  const node = (id: string) => plan.nodes.find((n: { id: string }) => n.id === id)
  const port = (id: string, dir: 'inputs' | 'outputs', item: string) =>
    node(id)?.[dir].find((x: { item: string }) => x.item === item)
  const sOut = port('fac:s', 'outputs', 'titanium_bar')
  const rIn = port('fac:r', 'inputs', 'titanium_bar')
  console.log(
    `  smelter ${node('fac:s')?.utilization} → bar ${sOut?.effective} (nominal ${sOut?.rate}); rod input gap ${rIn?.gap}, rod ${node('fac:r')?.utilization}`,
  )
  if (
    Math.abs((node('fac:s')?.utilization ?? 0) - 0.5) > 1e-6 ||
    Math.abs((sOut?.effective ?? 0) - 30) > 1e-6
  )
    fail('short smelter should run at 50% (effective output 30)')
  if (
    Math.abs((rIn?.gap ?? 0) - 30) > 1e-6 ||
    Math.abs((node('fac:r')?.utilization ?? 0) - 0.5) > 1e-6
  )
    fail('the reduced output should be a shortage on the next input')
  const ti = port('fac:bbm', 'inputs', 'titanium_ore')
  const wo = port('fac:bbm', 'inputs', 'wolfram_ore')
  console.log(
    `  two inputs: titanium gap ${ti?.gap}, wolfram flow ${wo?.flow} gap ${wo?.gap}, BBM ${node('fac:bbm')?.utilization}`,
  )
  if (
    Math.abs((ti?.gap ?? 0) - 15) > 1e-6 ||
    (wo?.gap ?? 1) > 1e-6 ||
    Math.abs((wo?.flow ?? 0) - 15) > 1e-6
  ) {
    fail('only the bottleneck input should show a shortage; the other one draws less')
  }
  // Unlinked input: assumed supplied.
  const free = sanitizeProject({
    ...raw,
    bases: [{ ...raw.bases[0], links: [raw.bases[0].links[0]] }],
  }).project
  const fm = buildModel(index, free, data.rails, cargo)
  const ff = solveFlows(fm)
  if (Math.abs((ff.activity.get('fac:bbm') ?? 0) - 1) > 1e-6)
    fail('a factory with unlinked inputs should run at full count')
} else {
  console.log('  skipped (recipes not in the data)')
}

// --- 8. Recipe without cycle time: no data, manual cycle time from the project ---
console.log('8. Recipes without cycle time (no data / manual cycle time)')
{
  const { applyCycleTimes, recipesWithoutRate } = await load('src/engine/missingData.ts')
  const { factoryPorts } = await load('src/engine/projectModel.ts')
  type R = {
    id: string
    product: string
    building: string
    rateFrom?: string
    perCycle?: { outputs: { amount: number }[] }
    outputs: { item: string; amount: number }[]
  }
  const noRate: R[] = recipesWithoutRate(data)
  console.log(
    `  ${noRate.length} recipe(s) without cycle time${noRate.length ? ': ' + noRate.map((r) => r.id).join(', ') : ''}`,
  )
  for (const r of noRate) {
    if (r.rateFrom !== 'missing')
      fail(`${r.id}: a recipe without cycle time should be rateFrom 'missing'`)
    const ports = factoryPorts(r, index.building(r.building), 1)
    if (
      !ports.outputs.length ||
      [...ports.inputs, ...ports.outputs].some((p: { nominal: number }) => p.nominal !== 0)
    ) {
      fail(`${r.id}: should keep its ports, with 0 rate`)
    }
  }
  if (noRate.length) {
    const r0 = noRate[0]
    const withTime = applyCycleTimes(data, { [r0.id]: 12 })
    const r1: R = withTime.recipes.find((r: R) => r.id === r0.id)
    const expected = (r0.perCycle!.outputs[0].amount * 60) / 12
    if (r1.rateFrom !== 'user' || Math.abs(r1.outputs[0].amount - expected) > 1e-9)
      fail('a manual cycle time should give the per-minute rate')
    const chain = planChain(index, [{ item: r0.product, rate: 5, consumer: null }], {
      enabledRecipes: enabled,
      objective: 'buildings',
    })
    if (
      !chain.missing.some((m: { item: string }) => m.item === r0.product) &&
      !data.recipes.some((x: R) => x.product === r0.product && !x.rateFrom)
    ) {
      fail('the chain builder must not use a recipe without cycle time')
    }
    const sp = sanitizeProject({
      version: 2,
      name: 'x',
      bases: [],
      railLinks: [],
      settings: { cycleTimes: { [r0.id]: 12, bad: -1 } },
    }).project
    if (sp.settings.cycleTimes[r0.id] !== 12 || 'bad' in sp.settings.cycleTimes)
      fail('sanitize should keep valid manual cycle times only')
  }
}

// --- 9. Link rail: auto (parallel rails, not an error) / manual (cap, congestion), distribution ---
console.log('9. Link rail (auto parallel, manual cap and congestion, distribution)')
if (
  index.recipe('titanium_bar_smelter') &&
  index.hasBuilding('ore_excavator') &&
  data.rails.length
) {
  const { railDistribution } = await load('src/engine/rails.ts')
  const linkBase = (rail: unknown) => ({
    version: 2,
    name: 'Link rail test',
    bases: [
      {
        id: 'b',
        name: 'B',
        factories: [{ id: 'f', recipe: 'titanium_bar_smelter', count: 10 }],
        mines: [
          {
            id: 'm',
            building: 'ore_excavator',
            item: 'titanium_ore',
            purity: 'normal',
            count: 1,
            output: 600,
          },
        ],
        links: [
          {
            id: 'a',
            from: 'mine:m',
            to: 'fac:f',
            item: 'titanium_ore',
            ...(rail === undefined ? {} : { rail }),
          },
        ],
        positions: {},
      },
    ],
    railLinks: [],
  })
  const run = (raw: unknown) => {
    const p = sanitizeProject(raw).project
    const m = buildModel(index, p, data.rails, cargo)
    const plan = buildBasePlan(index, p, m, solveFlows(m), 'b', { rails: data.rails, cargo })
    return {
      p,
      plan,
      edge: plan.edges[0],
      fac: plan.nodes.find((n: { id: string }) => n.id === 'fac:f'),
    }
  }
  const best = data.rails.at(-1)
  const auto = run(linkBase(undefined))
  const want = Math.ceil(600 / best.capacity - 1e-9)
  console.log(
    `  auto: flow ${auto.edge.rate}, ${auto.edge.rail?.count}× ${auto.edge.rail?.tier.name}, congested ${auto.edge.rail?.congested}, parallel ${auto.plan.summary.parallel}`,
  )
  if (
    Math.abs(auto.edge.rate - 600) > 1e-3 ||
    auto.edge.rail?.mode !== 'auto' ||
    auto.edge.rail.congested
  )
    fail('auto link rail: should carry 600 without congestion')
  if (auto.edge.rail && auto.edge.rail.count !== Math.max(1, want))
    fail('auto link rail: wrong parallel count')
  if (want > 1 && auto.plan.summary.parallel !== 1)
    fail('summary.parallel should count the auto rail that needs parallel rails')
  const v1 = data.rails[0]
  const low = run(linkBase([{ tier: v1.name, count: 1 }]))
  const { partsLabel, partsCapacity } = await load('src/engine/rails.ts')
  const gap = low.fac?.inputs[0]?.gap
  console.log(
    `  manual 1× ${v1.name}: flow ${low.edge.rate}, demand ${low.edge.demand}, congested ${low.edge.rail?.congested}, needed ${low.edge.rail ? partsLabel(low.edge.rail.needed) : '-'}, smelter ${low.fac?.utilization}, input gap ${gap}`,
  )
  if (Math.abs(low.edge.rate - v1.capacity) > 1e-6)
    fail('manual link rail: flow should be capped at the capacity')
  if (
    !low.edge.rail?.congested ||
    Math.abs(low.edge.demand - 600) > 1e-3 ||
    partsCapacity(low.edge.rail.needed) + 1e-9 < 600
  )
    fail('manual link rail: congestion (demand 600) not detected')
  if (Math.abs((gap ?? 0) - (600 - v1.capacity)) > 1e-3)
    fail('manual link rail: the capped link should be the bottleneck (input gap)')
  if (low.plan.summary.congestedLinks !== 1 || low.plan.summary.congested !== 1)
    fail('summary.congestedLinks should be 1')
  const plenty = run(linkBase([{ tier: v1.name, count: 10 }]))
  if (plenty.edge.rail?.congested || Math.abs(plenty.edge.rate - 600) > 1e-3)
    fail('manual link rail with enough capacity should not be congested')
  // Sanitize: the old { tier, count } form, merging equal tiers, dropping zero counts.
  const old = sanitizeProject(linkBase({ tier: 'v.2', count: 2 })).project.bases[0].links[0]
  const merged = sanitizeProject(
    linkBase([
      { tier: 'v.1', count: 2 },
      { tier: 'v.1', count: 1 },
      { tier: 'v.3', count: 0 },
    ]),
  ).project.bases[0].links[0]
  if (JSON.stringify(old.rail) !== '[{"tier":"v.2","count":2}]')
    fail(`sanitize: old link rail form should become a rail list (${JSON.stringify(old.rail)})`)
  if (JSON.stringify(merged.rail) !== '[{"tier":"v.1","count":3}]')
    fail(`sanitize: rail list should merge tiers and drop 0 (${JSON.stringify(merged.rail)})`)
  if ('rail' in sanitizeProject(linkBase('x')).project.bases[0].links[0])
    fail('sanitize: an invalid link rail should be dropped (auto)')
  // Distribution: 4 rails, 3 full + remainder; evenly in quarters (machines per unit flow: 1/60, 1/30).
  const t480 = { name: 'x3', capacity: 480 }
  const d = railDistribution(1700, [{ tier: t480, count: 4 }], 1 / 60, 1 / 30)
  const fill = d.fill.groups
    .map((g: { rails: number; share: { rate: number } }) => `${g.rails}×${g.share.rate}`)
    .join(' + ')
  const ev = d.even.groups[0].share
  console.log(
    `  distribution 1700 on 4× 480: even ${ev.rate} (${ev.sources.toFixed(3)} src / ${ev.targets.toFixed(3)} tgt), fill ${fill}`,
  )
  if (ev.rate !== 425 || Math.abs(ev.sources - 425 / 60) > 1e-9 || fill !== '3×480 + 1×260')
    fail('rail distribution is wrong')
  // Machines per rail: for the receiver the tightest item decides, for the source the one needing the most machines.
  const { machinesPerRate } = await load('src/engine/rails.ts')
  const items = [
    { item: 'a', rate: 300, perMachine: 30 },
    { item: 'b', rate: 150, perMachine: 30 },
  ]
  const tm = machinesPerRate(items, 'target')
  const sm = machinesPerRate(items, 'source')
  if (tm?.machines !== 5 || tm.bottleneck !== 'b' || sm?.machines !== 10)
    fail('machinesPerRate: target = bottleneck (5, b), source = max (10)')
} else {
  console.log('  skipped (recipes / rails not in the data)')
}

// --- 10. Multi-item rail, storage states, cargo feed from the attached rail ---
console.log('10. One rail for several items, storage balanced / positive, Dispatcher feed rail')
if (
  index.recipe('basic_building_material_fabricator') &&
  index.recipe('titanium_bar_smelter') &&
  index.hasBuilding('storage_depot_v1')
) {
  const mine = (id: string, item: string, output: number) => ({
    id,
    building: 'ore_excavator',
    item,
    purity: 'normal',
    count: 1,
    output,
  })
  const run = (base: Record<string, unknown>) => {
    const p = sanitizeProject({
      version: 2,
      name: 'x',
      bases: [{ id: 'b', name: 'B', positions: {}, ...base }],
      railLinks: [],
    }).project
    const m = buildModel(index, p, data.rails, cargo)
    return {
      p,
      m,
      plan: buildBasePlan(index, p, m, solveFlows(m), 'b', { rails: data.rails, cargo }),
    }
  }
  // Rail line → BBM factory with two items: ONE branch rail, the capacity on the sum (manual 1× v.1).
  const v1 = data.rails[0]
  const multi = run({
    factories: [{ id: 'f', recipe: 'basic_building_material_fabricator', count: 10 }],
    mines: [mine('ti', 'titanium_ore', 600), mine('wo', 'wolfram_ore', 600)],
    railLines: [
      { id: 'l', name: 'L', mode: 'auto', rails: [{ tier: null, count: 1 }], slots: null },
    ],
    links: [
      { id: 'a', from: 'mine:ti', to: 'line:l', item: 'titanium_ore' },
      { id: 'c', from: 'mine:wo', to: 'line:l', item: 'wolfram_ore' },
      {
        id: 'd',
        from: 'line:l',
        to: 'fac:f',
        item: 'titanium_ore',
        rail: [{ tier: v1.name, count: 1 }],
      },
      {
        id: 'e',
        from: 'line:l',
        to: 'fac:f',
        item: 'wolfram_ore',
        rail: [{ tier: v1.name, count: 1 }],
      },
    ],
  })
  const branch = multi.plan.linkRails.find(
    (r: { from: string; to: string }) => r.from === 'line:l' && r.to === 'fac:f',
  )
  const util = multi.plan.nodes.find((n: { id: string }) => n.id === 'fac:f')?.utilization
  console.log(
    `  line → BBM: ${branch?.links.length} items on one rail, total ${branch?.total} / ${branch?.choice?.capacity}, demand ${branch?.demand}, congested ${branch?.choice?.congested}, BBM ${util}`,
  )
  if (!branch || branch.links.length !== 2 || Math.abs(branch.total - v1.capacity) > 1e-6)
    fail('multi-item rail: both items should share one rail capped at its capacity')
  if (!branch?.choice?.congested || Math.abs(branch.demand - 600) > 1e-3)
    fail('multi-item rail: congestion on the total (demand 600) not detected')
  if (Math.abs((util ?? 0) - v1.capacity / 600) > 1e-6)
    fail('multi-item rail: the factory should run at the rail share')
  const edges = multi.plan.edges.filter((e: { railKey: string }) => e.railKey === branch?.key)
  if (
    edges.length !== 2 ||
    edges.some(
      (e: { railItems: number; railTotal: number }) =>
        e.railItems !== 2 || Math.abs(e.railTotal - branch.total) > 1e-9,
    )
  )
    fail('multi-item rail: both edges should carry the shared rail')
  // Storage: balanced (in = out) / positive (the excess accumulates; a small outgoing rail can be the cause).
  const store = (output: number, rail?: unknown) =>
    run({
      factories: [{ id: 's', recipe: 'titanium_bar_smelter', count: 5 }],
      mines: [mine('ti', 'titanium_ore', output)],
      storages: [
        { id: 'st', name: 'S', building: 'storage_depot_v1', item: 'titanium_ore', count: 1 },
      ],
      links: [
        { id: 'a', from: 'mine:ti', to: 'store:st', item: 'titanium_ore' },
        { id: 'c', from: 'store:st', to: 'fac:s', item: 'titanium_ore', ...(rail ? { rail } : {}) },
      ],
    }).plan.nodes.find((n: { id: string }) => n.id === 'store:st')?.special
  const bal = store(300)
  const pos = store(600)
  const capped = store(600, [{ tier: v1.name, count: 1 }])
  console.log(
    `  storage: ${bal?.state} (${bal?.inflow}→${bal?.outflow}), ${pos?.state} +${pos?.excess} full in ${pos?.fullInMinutes?.toFixed(2)} min, rail-capped ${capped?.state} +${capped?.excess} (rail full ${capped?.outRailFull})`,
  )
  if (bal?.state !== 'balanced' || Math.abs(bal.outflow - 300) > 1e-6)
    fail('storage: in = out should be balanced')
  if (
    pos?.state !== 'positive' ||
    Math.abs(pos.excess - 300) > 1e-6 ||
    Math.abs(pos.inflow - 600) > 1e-6
  )
    fail('storage: more in than out should be positive (+300)')
  if (
    capped?.state !== 'positive' ||
    !capped.outRailFull ||
    Math.abs(capped.excess - (600 - v1.capacity)) > 1e-6
  )
    fail('storage: a smaller outgoing rail should make it positive')
  // Dispatcher: automatic feed rail = the tier of the attached link's manual rail.
  const { dispatcherRate } = await load('src/engine/projectModel.ts')
  const disp = run({
    mines: [mine('ti', 'titanium_ore', 600)],
    dispatchers: [
      {
        id: 'd',
        name: 'D',
        building: 'cargo_dispatcher',
        item: 'titanium_ore',
        receiverId: null,
        feedRail: null,
      },
    ],
    links: [
      {
        id: 'a',
        from: 'mine:ti',
        to: 'disp:d',
        item: 'titanium_ore',
        rail: [{ tier: v1.name, count: 1 }],
      },
    ],
  })
  const dr = dispatcherRate(index, disp.p, disp.p.bases[0].dispatchers[0], data.rails)
  console.log(
    `  dispatcher feed from the link rail: ${dr.feedRail}, ${dr.rate}/min, fromLink ${dr.fromLink}`,
  )
  if (
    index.building('cargo_dispatcher').throughput &&
    typeof index.building('cargo_dispatcher').throughput === 'object' &&
    (dr.feedRail !== v1.name || !dr.fromLink)
  ) {
    fail('Dispatcher: the automatic feed rail should follow the manual rail of its incoming link')
  }
} else {
  console.log('  skipped (recipes / storage not in the data)')
}

// --- 11. Copy / paste (projectStore) ---
console.log('11. Copy / paste nodes with their links')
{
  const store = (await load('src/project/projectStore.ts')).useProject()
  store.importProject(
    JSON.stringify({
      version: 2,
      name: 'Copy test',
      bases: [
        {
          id: 'b',
          name: 'B',
          factories: [{ id: 'f', recipe: 'titanium_bar_smelter', count: 2 }],
          mines: [
            {
              id: 'm',
              building: 'ore_excavator',
              item: 'titanium_ore',
              purity: 'normal',
              count: 1,
              output: null,
            },
          ],
          receivers: [{ id: 'r', name: 'R-Titanium', building: 'x', item: 'titanium_bar' }],
          dispatchers: [
            {
              id: 'd',
              name: 'Dispatcher 1',
              building: 'x',
              item: 'titanium_bar',
              receiverId: 'r',
              feedRail: null,
            },
          ],
          links: [
            {
              id: 'a',
              from: 'mine:m',
              to: 'fac:f',
              item: 'titanium_ore',
              rail: [{ tier: null, count: 2 }],
            },
            { id: 'c', from: 'fac:f', to: 'disp:d', item: 'titanium_bar' },
          ],
          positions: {
            'mine:m': { x: 100, y: 100 },
            'fac:f': { x: 400, y: 160 },
            'disp:d': { x: 700, y: 160 },
            'recv:r': { x: 100, y: 400 },
          },
        },
      ],
      railLinks: [],
    }),
  )
  const copied = store.copyNodes('b', ['mine:m', 'fac:f', 'disp:d', 'recv:r'])
  const pasted = store.pasteNodes('b', { x: 1000, y: 1000 })
  const b = store.baseById('b')
  const newDisp = b.dispatchers.find((x: { id: string }) => x.id !== 'd')
  const newRecv = b.receivers.find((x: { id: string }) => x.id !== 'r')
  const newLinks = b.links.filter((l: { id: string }) => l.id !== 'a' && l.id !== 'c')
  const minX = Math.min(...pasted.ids.map((id: string) => b.positions[id]?.x ?? Infinity))
  const minY = Math.min(...pasted.ids.map((id: string) => b.positions[id]?.y ?? Infinity))
  console.log(
    `  copied ${copied.nodes} nodes / ${copied.links} links → pasted ${pasted.ids.length} / ${pasted.links}; names ${newRecv?.name}, ${newDisp?.name}; corner ${minX},${minY}`,
  )
  if (copied.nodes !== 4 || copied.links !== 2 || pasted.ids.length !== 4 || pasted.links !== 2)
    fail('copy / paste: wrong node or link count')
  if (
    !newDisp ||
    newDisp.receiverId !== newRecv?.id ||
    b.dispatchers.find((x: { id: string }) => x.id === 'd')?.receiverId !== 'r'
  )
    fail('copy / paste: the copied pair should be paired with each other, the original pair kept')
  if (newRecv?.name === 'R-Titanium' || newDisp?.name === 'Dispatcher 1')
    fail('copy / paste: Receiver / Dispatcher names must be unique')
  if (
    !newLinks.some((l: { rail?: { count: number }[] }) => l.rail?.[0]?.count === 2) ||
    newLinks.some(
      (l: { from: string; to: string }) =>
        !pasted.ids.includes(l.from) || !pasted.ids.includes(l.to),
    )
  ) {
    fail('copy / paste: the links should connect the new nodes (with the manual rail)')
  }
  if (minX !== 1000 || minY !== 1000)
    fail('copy / paste: the pasted group should start at the given point')
  if (
    store.selection.value.length !== 4 ||
    !store.selection.value.every((id: string) => pasted.ids.includes(id))
  )
    fail('copy / paste: the pasted nodes should stay selected')
  // Only the Dispatcher: its pair does not come along, so unpaired (with 1:1 it would not take it from the original).
  store.copyNodes('b', ['disp:d'])
  const only = store.pasteNodes('b')
  const lone = b.dispatchers.find((x: { id: string }) => `disp:${x.id}` === only.ids[0])
  if (!lone || lone.receiverId !== null)
    fail('copy / paste: a Dispatcher pasted without its Receiver should be unpaired')
  if (store.copyNodes('b', ['railin:x']).nodes !== 0)
    fail('copy: an inter-base rail end must not be copied')
}

// --- 12. Even distribution (no priority), the optimal switch, old shared rail → rail line ---
console.log(
  '12. Even distribution (sources split equally, consumers take equally), optimal switch, shared rail migration',
)
if (
  index.recipe('titanium_bar_smelter') &&
  index.recipe('titanium_rod_fabricator') &&
  index.hasBuilding('ore_excavator')
) {
  const mine = (id: string, output: number) => ({
    id,
    building: 'ore_excavator',
    item: 'titanium_ore',
    purity: 'normal',
    count: 1,
    output,
  })
  const flows = (base: Record<string, unknown>, distribution: string) => {
    const p = sanitizeProject({
      version: 2,
      name: 'x',
      bases: [{ id: 'b', name: 'B', positions: {}, ...base }],
      railLinks: [],
    }).project
    return solveFlows(buildModel(index, p, data.rails, cargo), new Set(), { distribution }).linkFlow
  }
  // Two smelters → one rod factory (480 demand): 240 + 240, not 480 + 0.
  const two = {
    factories: [
      { id: 's1', recipe: 'titanium_bar_smelter', count: 8 },
      { id: 's2', recipe: 'titanium_bar_smelter', count: 8 },
      { id: 'r', recipe: 'titanium_rod_fabricator', count: 8 },
    ],
    mines: [mine('m', 1920)],
    links: [
      { id: 'a1', from: 'mine:m', to: 'fac:s1', item: 'titanium_ore' },
      { id: 'a2', from: 'mine:m', to: 'fac:s2', item: 'titanium_ore' },
      { id: 'r1', from: 'fac:s1', to: 'fac:r', item: 'titanium_bar' },
      { id: 'r2', from: 'fac:s2', to: 'fac:r', item: 'titanium_bar' },
    ],
  }
  const even2 = flows(two, 'even')
  const opt2 = flows(two, 'optimal')
  console.log(
    `  two smelters → one: even ${even2.get('r1')} + ${even2.get('r2')}, optimal ${opt2.get('r1')} + ${opt2.get('r2')}`,
  )
  if (
    Math.abs((even2.get('r1') ?? 0) - 240) > 1e-6 ||
    Math.abs((even2.get('r2') ?? 0) - 240) > 1e-6
  )
    fail('even distribution: two sources should share 240 + 240')
  if (Math.abs((opt2.get('r1') ?? 0) + (opt2.get('r2') ?? 0) - 480) > 1e-6)
    fail('optimal distribution: total should still be 480')
  // a1,a2 → b1, a2 → b2, a2,a3 → b3: the output of a2 splits in thirds, b2 falls behind (160).
  const x3 = {
    factories: ['b1', 'b2', 'b3'].map((id) => ({ id, recipe: 'titanium_bar_smelter', count: 8 })),
    mines: [mine('a1', 480), mine('a2', 480), mine('a3', 480)],
    links: [
      { id: 'l11', from: 'mine:a1', to: 'fac:b1', item: 'titanium_ore' },
      { id: 'l21', from: 'mine:a2', to: 'fac:b1', item: 'titanium_ore' },
      { id: 'l22', from: 'mine:a2', to: 'fac:b2', item: 'titanium_ore' },
      { id: 'l23', from: 'mine:a2', to: 'fac:b3', item: 'titanium_ore' },
      { id: 'l33', from: 'mine:a3', to: 'fac:b3', item: 'titanium_ore' },
    ],
  }
  const e3 = flows(x3, 'even')
  console.log(
    `  3×3: a2 → b1 ${e3.get('l21')}, b2 ${e3.get('l22')}, b3 ${e3.get('l23')}; a1 → b1 ${e3.get('l11')}`,
  )
  if (
    ['l21', 'l22', 'l23'].some((k) => Math.abs((e3.get(k) ?? 0) - 160) > 1e-6) ||
    Math.abs((e3.get('l11') ?? 0) - 320) > 1e-6
  ) {
    fail('even distribution: a2 should split into thirds (160 each), a1 fills b1 (320)')
  }
} else {
  console.log('  skipped (recipes not in the data)')
}
{
  // Old shared rail → automatic rail line (the references change to line:).
  const r = sanitizeProject({
    version: 2,
    name: 'x',
    railLinks: [],
    bases: [
      {
        id: 'b',
        name: 'B',
        buses: [{ id: 'bb', name: 'Bus' }],
        mines: [
          {
            id: 'm',
            building: 'ore_excavator',
            item: 'titanium_ore',
            purity: 'normal',
            count: 1,
            output: 60,
          },
        ],
        links: [{ id: 'a', from: 'mine:m', to: 'bus:bb', item: 'titanium_ore' }],
        positions: { 'bus:bb': { x: 1, y: 2 } },
      },
    ],
  })
  const b = r.project.bases[0]
  console.log(
    `  shared rail → ${b.railLines.map((l: { id: string; mode: string }) => `${l.id} (${l.mode})`).join(', ')}; link → ${b.links[0]?.to}; position ${JSON.stringify(b.positions['line:bb'])}`,
  )
  if (
    b.railLines[0]?.id !== 'bb' ||
    b.railLines[0]?.mode !== 'auto' ||
    b.links[0]?.to !== 'line:bb' ||
    !b.positions['line:bb']
  )
    fail('an old shared rail should become an auto rail line with its links and position')
}

// --- 13. Undo / redo (projectStore history) ---
console.log('13. Undo / redo (steps, automatic placement is not a step)')
{
  const { initProject, useProject } = await load('src/project/projectStore.ts')
  initProject(data) // undo tracking (no localStorage here: fine)
  const store = useProject()
  const settle = () => new Promise((r) => setTimeout(r, 320)) // the snapshot is taken after 250 ms
  store.importProject(
    JSON.stringify({
      version: 2,
      name: 'Undo test',
      bases: [{ id: 'b', name: 'B', positions: {} }],
      railLinks: [],
    }),
  )
  await settle()
  store.addRailLine('b', { x: 0, y: 0 })
  await settle()
  const f = store.addFactory('b', 'titanium_bar_smelter', 1) // without a position, like what the program places
  await settle()
  store.withoutHistory(() => store.setPositions('b', { [`fac:${f.id}`]: { x: 300, y: 0 } }))
  await settle()
  const b = () => store.baseById('b')
  store.undo()
  const afterOne = `${b()?.railLines.length} line, ${b()?.factories.length} factory`
  store.undo()
  const afterTwo = `${b()?.railLines.length} line, ${b()?.factories.length} factory`
  store.redo()
  const afterRedo = `${b()?.railLines.length} line`
  console.log(`  undo → ${afterOne}; undo → ${afterTwo}; redo → ${afterRedo}`)
  if (afterOne !== '1 line, 0 factory')
    fail('undo should remove the factory (its automatic placement is not a separate step)')
  if (afterTwo !== '0 line, 0 factory' || afterRedo !== '1 line')
    fail('undo / redo steps are wrong')
}

// --- 14. Automatic machine count (Factory.auto): sized from the material reaching the linked inputs ---
console.log('14. Automatic machine count (from the available material, X full + 1, min 1)')
if (
  index.recipe('titanium_bar_smelter') &&
  index.recipe('titanium_rod_fabricator') &&
  index.hasBuilding('ore_excavator')
) {
  const { buildSizedModel } = await load('src/engine/projectModel.ts')
  const mine = (id: string, output: number) => ({
    id,
    building: 'ore_excavator',
    item: 'titanium_ore',
    purity: 'normal',
    count: 1,
    output,
  })
  const sized = (base: Record<string, unknown>, distribution = 'even') => {
    const p = sanitizeProject({
      version: 2,
      name: 'x',
      bases: [{ id: 'b', name: 'B', positions: {}, ...base }],
      railLinks: [],
    }).project
    const opts = { distribution }
    const m = buildSizedModel(index, p, data.rails, cargo, opts)
    const f = solveFlows(m, new Set(), opts)
    return { p, plan: buildBasePlan(index, p, m, f, 'b', { rails: data.rails, cargo }) }
  }
  // 250 ore: manual smelter ×2 (120) + automatic smelter (the remaining 130 → 2.17 → 3 machines) → automatic rod (3).
  const { p, plan } = sized({
    factories: [
      { id: 's', recipe: 'titanium_bar_smelter', count: 1 },
      { id: 'm2', recipe: 'titanium_bar_smelter', count: 2, auto: false },
      { id: 'r', recipe: 'titanium_rod_fabricator', count: 1 },
      { id: 'free', recipe: 'titanium_rod_fabricator', count: 2.5 },
    ],
    mines: [mine('ti', 250)],
    links: [
      { id: 'a', from: 'mine:ti', to: 'fac:s', item: 'titanium_ore' },
      { id: 'c', from: 'mine:ti', to: 'fac:m2', item: 'titanium_ore' },
      { id: 'b', from: 'fac:s', to: 'fac:r', item: 'titanium_bar' },
    ],
  })
  const node = (id: string) => plan.nodes.find((n: { id: string }) => n.id === id)
  const s = node('fac:s')
  const sIn = s?.inputs[0]
  console.log(
    `  auto smelter ${s?.count} (${s?.countMode}, ${s?.effectiveCount?.toFixed(3)} effective), rod ${node('fac:r')?.count} (${node('fac:r')?.countMode}), ` +
      `manual ${node('fac:m2')?.count} (${node('fac:m2')?.countMode}), unlinked ${node('fac:free')?.count} (${node('fac:free')?.countMode}); ` +
      `smelter input gap ${sIn?.gap}, partial ${sIn?.partial}`,
  )
  if (
    s?.count !== 3 ||
    s?.countMode !== 'auto' ||
    Math.abs((s?.effectiveCount ?? 0) - 130 / 60) > 1e-3
  )
    fail('auto smelter should get the remaining 130 (2.17 machines) and round up to 3')
  if (node('fac:r')?.count !== 3) fail('the auto rod factory should follow its auto source (3)')
  if (node('fac:m2')?.count !== 2 || node('fac:m2')?.countMode !== 'manual')
    fail('a manual factory keeps its count')
  if (node('fac:free')?.count !== 2.5 || node('fac:free')?.countMode !== 'auto-fallback')
    fail('an auto factory without linked inputs should use its stored count')
  if ((sIn?.gap ?? 1) > 1e-9 || Math.abs((sIn?.partial ?? 0) - 50) > 1e-3)
    fail('the rounding of an auto factory is not a shortage (partial 50 instead)')
  if (
    plan.summary.shortages.some(
      (x: { nodeId: string }) => x.nodeId === 'fac:s' || x.nodeId === 'fac:r',
    )
  )
    fail('auto factories should not be listed as short')
  if (
    p.bases[0].factories.find((f: { id: string }) => f.id === 's')?.auto !== true ||
    p.bases[0].factories.find((f: { id: string }) => f.id === 'm2')?.auto !== false
  ) {
    fail('sanitize: a missing auto field should default to true, false should stay')
  }
  // Exact (240 → 4 machines, 100%), with the optimal distribution too.
  for (const dist of ['even', 'optimal']) {
    const exact = sized(
      {
        factories: [{ id: 's', recipe: 'titanium_bar_smelter', count: 1 }],
        mines: [mine('ti', 240)],
        links: [{ id: 'a', from: 'mine:ti', to: 'fac:s', item: 'titanium_ore' }],
      },
      dist,
    ).plan
    const n = exact.nodes.find((x: { id: string }) => x.id === 'fac:s')
    console.log(`  exact fit (${dist}): ${n?.count} at ${Math.round((n?.utilization ?? 0) * 100)}%`)
    if (n?.count !== 4 || Math.abs((n?.utilization ?? 0) - 1) > 1e-6)
      fail(`auto count should be exactly 4 at 100% (${dist})`)
  }
  // Nothing reaches it: 1 machine stays, and the shortage shows.
  const none = sized({
    factories: [{ id: 's', recipe: 'titanium_bar_smelter', count: 5 }],
    mines: [mine('ti', 0)],
    links: [{ id: 'a', from: 'mine:ti', to: 'fac:s', item: 'titanium_ore' }],
  }).plan
  const nn = none.nodes.find((x: { id: string }) => x.id === 'fac:s')
  console.log(`  nothing arrives: ${nn?.count} machine, shortage ${nn?.inputs[0]?.gap}`)
  if (nn?.count !== 1 || !((nn?.inputs[0]?.gap ?? 0) > 0))
    fail('an auto factory that gets nothing should stay at 1 machine and show the shortage')
} else {
  console.log('  skipped (recipes not in the data)')
}

// --- 15. Unpaired cargo nodes with a virtual counterpart (VirtualCargo) ---
console.log('15. Virtual cargo counterpart (unpaired Dispatcher / Receiver calculate on their own)')
if (
  index.hasBuilding('cargo_dispatcher') &&
  index.hasBuilding('cargo_receiver') &&
  index.recipe('titanium_bar_smelter')
) {
  const { buildSizedModel } = await load('src/engine/projectModel.ts')
  const run = (base: Record<string, unknown>) => {
    const p = sanitizeProject({
      version: 2,
      name: 'x',
      bases: [{ id: 'b', name: 'B', positions: {}, ...base }],
      railLinks: [],
    }).project
    const opts = { distribution: 'even' }
    const m = buildSizedModel(index, p, data.rails, cargo, opts)
    const f = solveFlows(m, new Set(), opts)
    return { m, f, plan: buildBasePlan(index, p, m, f, 'b', { rails: data.rails, cargo }) }
  }
  const mine = {
    id: 'ti',
    building: 'ore_excavator',
    item: 'titanium_ore',
    purity: 'normal',
    count: 1,
    output: 300,
  }
  const dispatcher = (virtual: unknown, receiverId: string | null = null) => ({
    mines: [mine],
    dispatchers: [
      {
        id: 'd',
        name: 'D',
        building: 'cargo_dispatcher',
        item: 'titanium_ore',
        receiverId,
        feedRail: null,
        virtual,
      },
    ],
    receivers: [
      {
        id: 'r',
        name: 'R',
        building: 'cargo_receiver',
        item: 'titanium_ore',
        virtual: { mode: 'rail', rate: 0 },
      },
    ],
    links: [{ id: 'a', from: 'mine:ti', to: 'disp:d', item: 'titanium_ore' }],
  })
  const best = data.rails.at(-1)?.name
  const throughput = index.building('cargo_dispatcher').throughput as Record<string, number>
  const expectRail = best && typeof throughput === 'object' ? throughput[best] : 0

  const byRail = run(dispatcher({ mode: 'rail', rate: 0 }))
  const custom = run(dispatcher({ mode: 'custom', rate: 120 }))
  const off = run(dispatcher(null))
  const paired = run(dispatcher({ mode: 'custom', rate: 120 }, 'r'))
  const vd = (r: { f: { virtual: Map<string, number> } }) => r.f.virtual.get('disp:d') ?? 0
  console.log(
    `  dispatcher takes: by rails ${vd(byRail)} (throughput ${expectRail}), custom ${vd(custom)}, off ${vd(off)}, paired: virtual ${paired.m.nodes.get('disp:d')?.virtualCargo ? 'on' : 'ignored'}`,
  )
  if (Math.abs(vd(byRail) - Math.min(300, expectRail)) > 1e-3)
    fail('an unpaired Dispatcher (by rails) should take min(supply, throughput)')
  if (Math.abs(vd(custom) - 120) > 1e-3) fail('a custom virtual receiver should take its rate')
  if (vd(off) !== 0 || !off.plan.nodes.find((n: { id: string }) => n.id === 'disp:d')?.warning)
    fail('without the virtual receiver an unpaired Dispatcher takes nothing and warns')
  if (paired.m.nodes.get('disp:d')?.virtualCargo)
    fail('a paired Dispatcher should ignore its virtual receiver')

  // Receiver without a Dispatcher: the virtual dispatcher gives the item (manual smelter ×2 = 120 requested; custom 90 → 75%).
  const recv = (virtual: unknown) =>
    run({
      factories: [{ id: 's', recipe: 'titanium_bar_smelter', count: 2, auto: false }],
      receivers: [
        { id: 'r', name: 'R', building: 'cargo_receiver', item: 'titanium_ore', virtual },
      ],
      links: [{ id: 'a', from: 'recv:r', to: 'fac:s', item: 'titanium_ore' }],
    })
  const rRail = recv({ mode: 'rail', rate: 0 })
  const rCustom = recv({ mode: 'custom', rate: 90 })
  const util = (r: ReturnType<typeof recv>) =>
    r.plan.nodes.find((n: { id: string }) => n.id === 'fac:s')?.utilization ?? 0
  console.log(
    `  receiver gives: by rails ${rRail.f.virtual.get('recv:r')} (smelter ${Math.round(util(rRail) * 100)}%), custom 90 → ${rCustom.f.virtual.get('recv:r')} (${Math.round(util(rCustom) * 100)}%)`,
  )
  if (
    Math.abs((rRail.f.virtual.get('recv:r') ?? 0) - 120) > 1e-3 ||
    Math.abs(util(rRail) - 1) > 1e-6
  )
    fail('a Receiver by rails should serve the 120 request fully')
  if (
    Math.abs((rCustom.f.virtual.get('recv:r') ?? 0) - 90) > 1e-3 ||
    Math.abs(util(rCustom) - 0.75) > 1e-3
  )
    fail('a custom virtual dispatcher should cap the Receiver at 90 (smelter 75%)')
  if (rCustom.plan.nodes.find((n: { id: string }) => n.id === 'recv:r')?.warning)
    fail('a Receiver with a virtual dispatcher should not warn "no Dispatcher"')
} else {
  console.log('  skipped (cargo buildings not in the data)')
}

console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: OK')
process.exit(failed ? 1 : 0)
