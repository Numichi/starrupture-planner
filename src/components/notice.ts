/**
 * @module components/notice
 *
 * Short notification at the bottom of the canvas (e.g. "Chain built: 5 new nodes").
 * It disappears after a few seconds. There is a single instance, callable from anywhere.
 */
import { ref } from 'vue'

/** One notification. */
export interface Notice {
  text: string
  tone: 'info' | 'ok' | 'bad'
}

const notice = ref<Notice | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

/** Shows a notification for `ms` milliseconds (replacing the current one). */
function notify(text: string, tone: Notice['tone'] = 'info', ms = 4500) {
  notice.value = { text, tone }

  clearTimeout(timer)
  timer = setTimeout(() => (notice.value = null), ms)
}

/** The shared notification state. */
export function useNotice() {
  return { notice, notify }
}
