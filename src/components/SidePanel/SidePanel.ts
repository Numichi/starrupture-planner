/**
 * @component SidePanel
 *
 * The side panel – an overview: editing happens on the canvas (right-click, drag); the panel
 * shows the bases, the summary and the node list. Section order:
 *
 *   Bases → Summary → Nodes → Drone rails → Missing data (when there is any) → Settings
 *
 * The section styles are shared: `src/styles/_panel.scss`.
 */
import { computed, defineComponent } from 'vue'

import BaseList from '@/components/panel/BaseList/BaseList.vue'
import MissingDataSection from '@/components/panel/MissingDataSection/MissingDataSection.vue'
import NodesSection from '@/components/panel/NodesSection/NodesSection.vue'
import RailsSection from '@/components/panel/RailsSection/RailsSection.vue'
import SettingsSection from '@/components/panel/SettingsSection/SettingsSection.vue'
import SummarySection from '@/components/panel/SummarySection/SummarySection.vue'
import { usePlanner } from '@/composables/usePlanner'
import { LOCALE } from '@/config'
import { useProject } from '@/project/projectStore'

export default defineComponent({
  name: 'SidePanel',

  components: {
    BaseList,
    MissingDataSection,
    NodesSection,
    RailsSection,
    SettingsSection,
    SummarySection,
  },

  setup() {
    const { gameData, loadedAt, reloadData } = usePlanner()
    const { project } = useProject()

    /** When the data files were (re)loaded last. */
    const loadedAtText = computed(() => loadedAt.value?.toLocaleTimeString(LOCALE) ?? '–')

    return { gameData, project, loadedAtText, reloadData }
  },
})
