/**
 * @module engine/format
 *
 * Number formatting. Every displayed number goes through here, so the number of decimals
 * and the separators are set in one place (the locale is in `config.ts`).
 */
import { LOCALE, POWER_UNIT_LABEL } from '../config'

const twoDecimals = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 })
const oneDecimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 })

/** A rate: `1,600` · `26.67` · `0.5`. */
export const formatRate = (n: number) => twoDecimals.format(n)

/** A building count: `26.67`. */
export const formatCount = (n: number) => twoDecimals.format(n)

/** Power: `1,234.5 MW`. */
export const formatPower = (n: number) => `${oneDecimal.format(n)} ${POWER_UNIT_LABEL}`

/**
 * A count with its noun, singular only for exactly 1: `1 machine` · `2 machines` · `1.5 machines`.
 *
 * @param noun the singular noun; the plural adds an "s"
 */
export const formatQuantity = (n: number, noun: string) =>
  `${formatCount(n)} ${noun}${n === 1 ? '' : 's'}`
