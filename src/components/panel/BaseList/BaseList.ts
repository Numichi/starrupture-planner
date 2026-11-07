/**
 * @component BaseList
 *
 * Bases (folders / groups) and the project actions.
 *
 * Every base has its own canvas. A new base is empty. Click: open, ✎: rename, 🗑: delete
 * (its cargo pairs and inter-base rails are deleted too). Below: save the project to a file
 * (export), load it (import), new project.
 */
import { computed, defineComponent, nextTick, ref } from 'vue'

import { usePlanner } from '@/composables/usePlanner'
import { formatPower } from '@/engine/format'
import { useProject } from '@/project/projectStore'

export default defineComponent({
  name: 'BaseList',

  setup() {
    const {
      project,
      activeBaseId,
      setActiveBase,
      addBase,
      renameBase,
      removeBase,
      exportProject,
      importProject,
      resetProject,
      projectWarnings,
    } = useProject()
    const { basePlans, gameData } = usePlanner()

    const totalPower = computed(() =>
      [...basePlans.value.values()].reduce((a, p) => a + p.summary.totalPower, 0),
    )

    // --- Rename in place ---

    /** Id of the base being renamed (null: none). */
    const renaming = ref<string | null>(null)
    const draft = ref('')

    /** The rename input (inside `v-for`, so Vue fills an array). */
    const renameInput = ref<HTMLInputElement[] | null>(null)

    async function startRename(id: string, name: string) {
      renaming.value = id
      draft.value = name

      await nextTick()
      renameInput.value?.[0]?.select()
    }

    function finishRename() {
      if (renaming.value) renameBase(renaming.value, draft.value)

      renaming.value = null
    }

    function confirmRemove(id: string, name: string) {
      const question = `Delete the base "${name}"? Its cargo pairs and inter-base rails are deleted too.`

      if (confirm(question)) removeBase(id)
    }

    // --- Export / import / new project ---

    function download() {
      const blob = new Blob([exportProject()], { type: 'application/json' })
      const a = document.createElement('a')

      a.href = URL.createObjectURL(blob)
      a.download = `${project.value.name || 'project'}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    }

    const fileInput = ref<HTMLInputElement | null>(null)

    async function onFile(e: Event) {
      const input = e.target as HTMLInputElement
      const file = input.files?.[0]

      if (!file) return

      try {
        importProject(await file.text())
      } catch (err) {
        alert(`The file could not be read: ${err instanceof Error ? err.message : err}`)
      }

      input.value = ''
    }

    function newProject() {
      if (
        confirm(
          'Start a new project from the starter sample? The current one is lost unless you exported it.',
        )
      ) {
        resetProject(gameData.value)
      }
    }

    return {
      project,
      activeBaseId,
      setActiveBase,
      addBase,
      projectWarnings,
      basePlans,
      totalPower,
      formatPower,
      renaming,
      draft,
      renameInput,
      startRename,
      finishRename,
      confirmRemove,
      download,
      fileInput,
      onFile,
      newProject,
    }
  },
})
