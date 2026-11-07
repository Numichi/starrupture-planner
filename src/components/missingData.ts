/**
 * @module components/missingData
 *
 * Missing data – shared UI texts.
 *
 * A recipe without a rate in the data (its cycle time is unknown):
 *   - 'missing': no data, the factory computes with 0 (⚠),
 *   - 'user':    the player entered the cycle time manually (⚠, with a different text).
 *
 * The manual value lives in the project (`settings.cycleTimes`), see `engine/missingData.ts`.
 * The UI never names a source (where data could come from).
 */
import type { Recipe } from '../data/types'
import { formatCount } from '../engine/format'

/** The note on a recipe rate that is not from the data. */
export interface RateNote {
  kind: 'missing' | 'user'

  /** Short label (port row, list). */
  short: string

  /** Full explanation (tooltip, editor). */
  text: string
}

/** The note on a recipe's rate, or null when the rate comes from the data (certain). */
export function rateNote(recipe: Recipe | undefined | null): RateNote | null {
  if (!recipe?.perCycle) return null

  if (recipe.rateFrom === 'user') {
    const t = formatCount(recipe.cycleTime ?? 0)

    return {
      kind: 'user',
      short: `manual: ${t} s`,
      text:
        `Manually entered cycle time: ${t} s. This recipe has no cycle time in the data; ` +
        'until the data is updated, this value is used.',
    }
  }

  return {
    kind: 'missing',
    short: 'no data',
    text:
      'No data: the cycle time of this recipe is unknown, so the factory computes with 0.\n' +
      '1) There will be no data until the next data update.\n' +
      '2) Meanwhile you can enter it: click the factory (editor), or in the left panel: Missing data.',
  }
}

/** Per-cycle summary, e.g. "Epoxy ×2, Aerogel ×2 → Heat Shield ×2". */
export function perCycleText(recipe: Recipe, name: (item: string) => string): string {
  if (!recipe.perCycle) return ''

  const list = (xs: { item: string; amount: number }[]) =>
    xs.map((x) => `${name(x.item)} ×${formatCount(x.amount)}`).join(', ')

  return `${list(recipe.perCycle.inputs) || '–'} → ${list(recipe.perCycle.outputs)}`
}
