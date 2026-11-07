/**
 * @module config
 *
 * Global settings: every number and label that depends on the game but is not a specific
 * item or recipe. When the planner is adapted to another game, this file and the files in
 * `public/data/` are the first to change.
 */

/**
 * Unit label of rates in the UI.
 *
 * All data (recipes, mines, Dispatchers, rails) is stored in items per minute in
 * `public/data/`; the planner never converts time units. This is only the label.
 */
export const RATE_UNIT_LABEL = '/min'

/** Unit label of power. */
export const POWER_UNIT_LABEL = 'MW'

/** Locale of number formatting (decimal separator, thousands separator). */
export const LOCALE = 'en-US'

/**
 * Maximum number of inputs of a recipe when the building does not set `maxInputs`.
 *
 * Validation only: exceeding it produces a warning. The engine itself handles any number
 * of inputs.
 */
export const MAX_RECIPE_INPUTS = 4

/**
 * How power is counted per node.
 *
 * - `true` (default): rounded up – a fractional machine is placed but works part-time,
 *   and still draws full power (1.5 machines = 2 × power).
 * - `false`: a partial machine draws proportionally (1.5 machines = 1.5 × power).
 */
export const POWER_USES_ROUNDED_COUNT = true

/**
 * "Build chain": penalty per unit of rate for an item without any source, used by the
 * recipe selection. It applies when no enabled recipe, mine or existing source provides
 * the item, and must be orders of magnitude larger than any recipe cost.
 */
export const IMPORT_PENALTY = 1e6

/** Numbers below this are treated as zero (filters floating-point noise). */
export const EPSILON = 1e-7
