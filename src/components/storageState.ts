/**
 * @module components/storageState
 *
 * Storage state – shared UI texts.
 *
 * A storage passes on as much as it gets (when it is taken). Its states:
 *   - balanced: in = out,
 *   - positive: more goes in than out – the excess accumulates in it (the consumers do not
 *     request more, or the capacity of the outgoing manual rail is below the inflow),
 *   - sink: it has no outgoing link, everything stays inside (it fills up).
 *
 * The calculation: `engine/flow.ts` (pass-through storage: Σ in = Σ out + excess), `engine/plan.ts`.
 */
import { RATE_UNIT_LABEL } from '../config'
import { formatRate } from '../engine/format'
import type { SpecialInfo } from '../engine/plan'

/** The storage variant of the special node info. */
export type StorageInfo = Extract<SpecialInfo, { type: 'storage' }>

/** The texts of a storage state. */
export interface StorageState {
  /** Short label (node footer, list). */
  short: string

  /** Full explanation (tooltip, editor, link window). */
  long: string

  /** 'warn': it accumulates (positive / sink); null: neutral. */
  tone: 'warn' | null
}

const fillText = (x: StorageInfo) =>
  x.fullInMinutes !== null ? `full in ≈ ${formatRate(x.fullInMinutes)} min` : ''

/** The state texts of a storage. */
export function storageState(x: StorageInfo): StorageState {
  const u = RATE_UNIT_LABEL

  if (x.inflow <= 0 && x.outflow <= 0) {
    return { short: 'no traffic', long: 'No traffic: nothing comes in.', tone: null }
  }

  if (x.state === 'sink') {
    const fill = fillText(x)

    return {
      short: `sink: +${formatRate(x.excess)}${fill ? ` · ${fill}` : ''}`,
      long:
        `Sink (no outgoing link): everything stays inside, +${formatRate(x.excess)} ${u} accumulates.` +
        (fill ? ` ${fill}.` : ''),
      tone: 'warn',
    }
  }

  if (x.state === 'positive') {
    const fill = fillText(x)
    const why = x.outRailFull
      ? 'the capacity of the outgoing rail is below the inflow'
      : 'the consumers do not request more'

    return {
      short: `positive: +${formatRate(x.excess)} ${u}${fill ? ` · ${fill}` : ''}`,
      long:
        `Positive: more goes in (${formatRate(x.inflow)}) than out (${formatRate(x.outflow)} ${u}), because ${why}. ` +
        `The excess (+${formatRate(x.excess)} ${u}) accumulates in it.` +
        (fill ? ` ${fill}.` : ''),
      tone: 'warn',
    }
  }

  return {
    short: `balanced: in = out ${formatRate(x.outflow)}`,
    long: `Balanced: it gives as much as it gets (${formatRate(x.outflow)} ${u}).`,
    tone: null,
  }
}
