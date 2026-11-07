/**
 * @component SpecialNode
 *
 * Special nodes: mine, Receiver, Dispatcher, storage, incoming / outgoing inter-base rail.
 *
 * Structure: header (name + kind), item rows with ports, footer (pair, state).
 *
 *   Mine        source: gives the item on its right port. The footer shows the purity and
 *               the rate per building (or "custom output"), and how much the links take.
 *   Receiver    source: passes on what its Dispatcher(s) send – or, unpaired, what its
 *               virtual dispatcher gives. The footer shows its pair and what it gets.
 *   Dispatcher  gets the item on its left port and sends it to its pair – or, unpaired, to
 *               its virtual receiver. The footer shows its pair and the throughput load.
 *   Storage     a pass-through buffer (when it has an outgoing link), or a sink: then it
 *               shows how long until it is full.
 *   Inter-base rail  the border of the base: it can carry several items; the footer shows
 *               the other base and the required rail tier.
 *
 * Cargo pairs are NOT joined by a line, only by their names (a link). When the pair is in
 * another base, clicking its name jumps the graph there (`goto`). Clicking / dragging an
 * item row: `port` event (as in GraphNode).
 */
import { computed, defineComponent, ref, watch, type PropType } from 'vue'

import ItemIcon from '@/components/ItemIcon/ItemIcon.vue'
import type { PortDown } from '@/components/graphEvents'
import { storageState } from '@/components/storageState'
import { fitText, textWidth } from '@/components/textFit'
import { usePlanner } from '@/composables/usePlanner'
import { RATE_UNIT_LABEL } from '@/config'
import { formatCount, formatPower, formatQuantity, formatRate } from '@/engine/format'
import type { PositionedNode } from '@/engine/layout'
import { KIND_SPEC, NODE, footerLineY, portPosition } from '@/engine/nodeGeometry'
import type { PlanVirtualCargo } from '@/engine/plan'
import { railLabel } from '@/engine/rails'

/** Kind labels in the header. */
const KIND_LABEL: Record<string, string> = {
  mine: 'Mine',
  receiver: 'Receiver',
  dispatcher: 'Dispatcher',
  storage: 'Storage',
  railIn: 'Incoming rail',
  railOut: 'Outgoing rail',
}

/** First footer line: the pair / the other base (clickable when it leads elsewhere). */
interface LinkLine {
  text: string
  target?: { baseId: string; nodeId: string }
}

/** Second footer line: the state. */
interface StatusLine {
  text: string
  bad: boolean
  warn?: boolean
}

/** Short limit text of a virtual cargo counterpart: rail-based or custom, with its capacity. */
function virtualLimit(v: PlanVirtualCargo): string {
  const cap = v.capacity === null ? 'unlimited' : `${formatRate(v.capacity)} ${RATE_UNIT_LABEL}`

  return v.mode === 'custom' ? `custom ${cap}` : `by rails ${cap}`
}

export default defineComponent({
  name: 'SpecialNode',

  components: { ItemIcon },

  props: {
    pos: { type: Object as PropType<PositionedNode>, required: true },
    dimmed: { type: Boolean, default: false },
    selected: { type: Boolean, default: false },

    /** Highlight: the pair under the mouse, or after a jump. */
    highlighted: { type: Boolean, default: false },
  },

  emits: {
    port: (_e: PortDown) => true,
    goto: (_baseId: string, _nodeId: string) => true,
  },

  setup(props, { emit }) {
    const { index } = usePlanner()
    const u = RATE_UNIT_LABEL

    const node = computed(() => props.pos.node)
    const s = computed(() => node.value.special)
    const w = computed(() => props.pos.width)
    const h = computed(() => props.pos.height)

    const kindLabel = computed(() => {
      const x = s.value

      if (x?.type === 'storage' && x.storage.count > 1) return `Storage ×${x.storage.count}`
      if (x?.type === 'mine') return `Mine ×${formatCount(x.mine.count)}`

      return KIND_LABEL[node.value.kind] ?? ''
    })

    /** Item rows: the port side depends on the kind (source: right, consumer: left, storage: both). */
    const rows = computed(() => {
      const n = node.value
      const ports = n.outputs.length ? n.outputs : n.inputs
      const side = n.outputs.length ? 'out' : 'in'

      return ports.map((p, i) => {
        const inPort = n.inputs.find((x) => x.item === p.item)
        const outPort = n.outputs.find((x) => x.item === p.item)

        return {
          p,
          item: index.value.item(p.item),
          y: portPosition(n, side, i).y,
          inPort,
          outPort,

          /** The shown rate: nominal for a mine, the flow elsewhere. */
          rate: n.kind === 'mine' ? p.rate : (inPort ?? outPort)!.flow || p.rate,
        }
      })
    })

    function onPort(dir: 'in' | 'out', item: string, e: PointerEvent) {
      emit('port', { nodeId: node.value.id, dir, item, event: e })
    }

    const linkLine = computed<LinkLine | null>(() => {
      const x = s.value

      if (!x) return null

      if (x.type === 'receiver') {
        if (x.pairs.length === 0 && x.virtual)
          return { text: `← virtual dispatcher · ${virtualLimit(x.virtual)}` }
        if (x.pairs.length === 0) return { text: 'no Dispatcher' }

        const remote = x.pairs.find((p) => !p.sameBase)
        const target = remote ? { baseId: remote.baseId, nodeId: remote.nodeId } : undefined

        if (x.pairs.length > 1) {
          return {
            text: `← ${x.pairs.length} Dispatchers${remote ? ` · ${remote.baseName}` : ''}`,
            target,
          }
        }

        const p = x.pairs[0]

        return { text: `← ${p.name}${p.sameBase ? '' : ` · ${p.baseName}`}`, target }
      }

      if (x.type === 'dispatcher') {
        if (!x.pair && x.virtual) return { text: `→ virtual receiver · ${virtualLimit(x.virtual)}` }
        if (!x.pair) return { text: 'not paired' }

        const where = x.pair.sameBase ? '' : ` · ${x.pair.baseName}`
        const shared = x.siblings > 1 ? ` (${x.siblings} send to it)` : ''

        return {
          text: `→ ${x.pair.name}${where}${shared}`,
          target: x.pair.sameBase ? undefined : { baseId: x.pair.baseId, nodeId: x.pair.nodeId },
        }
      }

      if (x.type === 'railIn' || x.type === 'railOut') {
        const arrow = x.type === 'railIn' ? '←' : '→'
        const other = x.type === 'railIn' ? `railout:${x.link.id}` : `railin:${x.link.id}`

        return {
          text: `${arrow} ${x.otherBaseName}`,
          target: { baseId: x.otherBaseId, nodeId: other },
        }
      }

      if (x.type === 'storage') {
        return {
          text: `${x.storage.count} × ${formatRate(x.unitCapacity)} = ${formatRate(x.capacity)} pcs`,
        }
      }

      if (x.type === 'mine') {
        if (x.mine.output !== null)
          return { text: `custom output · ${formatQuantity(x.mine.count, 'building')}` }

        const rate = `${formatRate(x.perBuilding)} ${u}/building`

        return { text: x.purityName ? `${x.purityName} · ${rate}` : rate }
      }

      return null
    })

    const statusLine = computed<StatusLine | null>(() => {
      const x = s.value

      if (!x) return null
      if (node.value.warning) return { text: node.value.warning, bad: true }

      switch (x.type) {
        case 'receiver':
          return {
            text: `gets ${formatRate(x.received + (x.virtual?.flow ?? 0))} ${u}`,
            bad: false,
          }

        case 'dispatcher': {
          if (x.virtual) {
            const cap = x.virtual.capacity
            const pct = cap ? ` (${Math.round((x.virtual.flow / cap) * 100)}%)` : ''
            const limit = cap !== null ? ` / ${formatRate(cap)}` : ''

            return { text: `takes ${formatRate(x.virtual.flow)}${limit}${pct}`, bad: false }
          }

          const pct = x.throughput > 0 ? Math.round((x.sent / x.throughput) * 100) : 0
          const feed = x.rateInfo.feedRail ? ` · from ${x.rateInfo.feedRail} rail` : ''

          return {
            text: `sends ${formatRate(x.sent)} / ${formatRate(x.throughput)} (${pct}%)${feed}`,
            bad: false,
          }
        }

        case 'mine': {
          const pct = x.total > 0 ? Math.round((x.used / x.total) * 100) : 0

          return {
            text: `taken ${formatRate(x.used)} / ${formatRate(x.total)} (${pct}%)`,
            bad: false,
          }
        }

        case 'storage': {
          const st = storageState(x)

          return { text: st.short, bad: false, warn: st.tone === 'warn' }
        }

        default:
          return null
      }
    })

    /** Inter-base rail: the footer is one line – other base + total + rail tier. */
    const railText = computed(() => {
      const x = s.value

      if (!x || (x.type !== 'railIn' && x.type !== 'railOut')) return ''

      const r = node.value.rail

      return `${formatRate(x.total)} ${u}` + (r ? ` · ${railLabel(r)}` : '')
    })

    const isRail = computed(() => node.value.kind === 'railIn' || node.value.kind === 'railOut')

    /** Building icon in the header (when it has one and it loads). */
    const iconFailed = ref(false)

    watch(
      () => node.value.building?.icon,
      () => (iconFailed.value = false),
    )

    const buildingIcon = computed(() => (!iconFailed.value ? node.value.building?.icon : undefined))

    const emptyText = computed(() => {
      const k = node.value.kind

      return k === 'railIn' || k === 'railOut' || k === 'dispatcher' || k === 'storage'
        ? 'drag a link here'
        : 'no item selected'
    })

    const tooltip = computed(() => {
      const lines = [`${kindLabel.value}: ${node.value.title}`]
      const x = s.value

      if (x?.type === 'receiver' && x.pairs.length > 1) {
        lines.push(
          'Its Dispatchers:',
          ...x.pairs.map((p) => `  ${p.name}${p.sameBase ? '' : ` · ${p.baseName}`}`),
        )
      } else if (linkLine.value) {
        lines.push(linkLine.value.text)
      }

      if (x?.type === 'receiver' && x.outputLimit !== null)
        lines.push(`Output at most ${formatRate(x.outputLimit)} ${u}`)

      if (x?.type === 'dispatcher') {
        const feed = x.rateInfo.feedRail ? ` (with a ${x.rateInfo.feedRail} feed rail)` : ''

        lines.push(`Throughput: ${formatRate(x.throughput)} ${u}${feed}`)
      }

      if (x?.type === 'mine') {
        lines.push(
          `${node.value.building?.name ?? ''} · ${formatQuantity(node.value.count, 'building')} ` +
            `(to place ${node.value.placed}) · power ${formatPower(node.value.power)}`,
        )
      }

      if (x?.type === 'storage') lines.push(storageState(x).long)
      else if (statusLine.value) lines.push(statusLine.value.text)

      if (isRail.value) lines.push(railText.value)

      lines.push('Click: edit · right-click: menu · item row: link')

      return lines.join('\n')
    })

    const kindWidth = computed(() => textWidth(kindLabel.value.toUpperCase(), 10) * 1.08 + 8)
    const titleText = computed(() =>
      fitText(
        node.value.title,
        w.value - 10 - kindWidth.value - (buildingIcon.value ? 28 : 10),
        12,
        650,
      ),
    )

    function rowName(name: string, rate: number): string {
      const rateWidth = textWidth(formatRate(rate), 11.5, 600) + textWidth(u, 9.5)

      return fitText(name, w.value - 12 - rateWidth - 8 - 34, 11.5)
    }

    /** A footer text fitted into the node width (minus `reserve` px). */
    const footer = (text: string, reserve = 0) => fitText(text, w.value - 20 - reserve, 10.5)

    /** Width reserved for the rail text in the inter-base rail footer. */
    const railReserve = computed(() => textWidth(railText.value, 10.5) + 8)

    function goto() {
      const t = linkLine.value?.target

      if (t) emit('goto', t.baseId, t.nodeId)
    }

    /** A clickable pair link must not start a node drag. */
    function onLinkPointerDown(e: PointerEvent) {
      if (linkLine.value?.target) e.stopPropagation()
    }

    const rootClass = computed(() => [
      `special--${node.value.kind}`,
      {
        'special--dimmed': props.dimmed,
        'special--selected': props.selected,
        'special--highlighted': props.highlighted,
        'special--warn': node.value.warning,
      },
    ])

    /** The header shape: rounded top corners, flat bottom. */
    const headerPath = computed(
      () =>
        `M0,${NODE.headerHeight} V7 A7,7 0 0 1 7,0 H${w.value - 7} A7,7 0 0 1 ${w.value},7 V${NODE.headerHeight} Z`,
    )

    /** Vertical centre of the empty-state text. */
    const emptyY = computed(
      () => NODE.headerHeight + NODE.padding + KIND_SPEC[node.value.kind].minBody / 2,
    )

    return {
      node,
      w,
      h,
      kindLabel,
      rows,
      onPort,
      linkLine,
      statusLine,
      railText,
      railReserve,
      isRail,
      iconFailed,
      buildingIcon,
      emptyText,
      emptyY,
      tooltip,
      titleText,
      rowName,
      footer,
      goto,
      onLinkPointerDown,
      rootClass,
      headerPath,
      footerLineY,
      formatRate,
      NODE,
      RATE_UNIT_LABEL,
    }
  },
})
