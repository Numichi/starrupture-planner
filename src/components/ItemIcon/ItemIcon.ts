/**
 * @component ItemIcon
 *
 * Item icon. Shows the item's `icon` image (public/data/items/*.yml) when it has one; when
 * it has none, or the image does not load, a coloured circle with the short label.
 *
 * Usable inside SVG and in HTML:
 *   - in SVG (graph):    `<ItemIcon :item="item" :size="16" :x="10" :y="20" />`
 *   - in HTML (panel):   `<ItemIcon :item="item" :size="18" standalone />`
 *
 * (x, y) is the CENTRE of the icon.
 */
import { computed, defineComponent, ref, watch, type PropType } from 'vue'

import type { Item } from '@/data/types'

/** Relative luminance above which a background counts as light (dark text on it). */
const LIGHT_BACKGROUND = 0.55

export default defineComponent({
  name: 'ItemIcon',

  props: {
    item: { type: Object as PropType<Item>, required: true },
    size: { type: Number, default: 16 },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },

    /** true: wraps the icon in its own `<svg>`, so it works in HTML too. */
    standalone: { type: Boolean, default: false },
  },

  setup(props) {
    /** The image did not load (wrong path) → a coloured circle instead. */
    const failed = ref(false)

    watch(
      () => props.item.icon,
      () => (failed.value = false),
    )

    const showImage = computed(() => !!props.item.icon && !failed.value)
    const label = computed(() => props.item.short ?? props.item.name.slice(0, 2))

    /** Dark text on a light background, light text on a dark one – so it stays readable. */
    const textColor = computed(() => {
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(props.item.color)

      if (!m) return '#fff'

      const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255)
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b

      return luminance > LIGHT_BACKGROUND ? '#1b1b1f' : '#ffffff'
    })

    const cx = computed(() => (props.standalone ? props.size / 2 : props.x))
    const cy = computed(() => (props.standalone ? props.size / 2 : props.y))
    const fontSize = computed(() => props.size * (label.value.length > 2 ? 0.36 : 0.46))

    return { failed, showImage, label, textColor, cx, cy, fontSize }
  },
})
