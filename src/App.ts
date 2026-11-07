/**
 * @component App
 *
 * Main layout: the side panel on the left, the graph of the active base on the right, and
 * above it (when open) the editor. On a narrow screen they stack vertically.
 */
import { defineComponent } from 'vue'

import EntityEditor from '@/components/EntityEditor/EntityEditor.vue'
import ProductionGraph from '@/components/ProductionGraph/ProductionGraph.vue'
import SidePanel from '@/components/SidePanel/SidePanel.vue'

export default defineComponent({
  name: 'App',

  components: { EntityEditor, ProductionGraph, SidePanel },
})
