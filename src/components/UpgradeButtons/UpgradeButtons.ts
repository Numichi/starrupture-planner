/**
 * @component UpgradeButtons
 *
 * Upgrade buttons (factory and mine editor). The button is always shown:
 *   - an upgraded (v.2) variant exists: "↑ <building>" buttons (for a factory per recipe,
 *     e.g. a variant with a different ingredient as well),
 *   - a base variant exists (this one is already the upgraded one): "↓ <building>" buttons,
 *   - no upgraded variant: a disabled "↑ Upgrade" button, with a note below that this
 *     building has no upgraded variant.
 *
 * Event: `upgrade(option)` – the caller performs it (`useEditorActions › upgrade`).
 */
import { computed, defineComponent, type PropType } from 'vue'

import type { UpgradeOption } from '@/engine/upgrades'

export default defineComponent({
  name: 'UpgradeButtons',

  props: {
    options: { type: Array as PropType<UpgradeOption[]>, required: true },

    /** The name of the current building (for the note). */
    building: { type: String, required: true },

    /** "factory" / "mine" (for the note). */
    noun: { type: String, required: true },
  },

  emits: {
    upgrade: (_option: UpgradeOption) => true,
  },

  setup(props, { emit }) {
    const ups = computed(() => props.options.filter((o) => o.direction === 'up'))
    const downs = computed(() => props.options.filter((o) => o.direction === 'down'))

    const note = computed(() => {
      if (ups.value.length) return ''

      return downs.value.length
        ? `This is already the upgraded variant (${props.building}); there is nothing better.`
        : `This ${props.noun} (${props.building}) has no upgraded variant.`
    })

    const choose = (option: UpgradeOption) => emit('upgrade', option)

    return { ups, downs, note, choose }
  },
})
