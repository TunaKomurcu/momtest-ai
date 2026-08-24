/**
 * Primary conversational model — interviewer, PM intake dialogue, and
 * interview/brief/script generation. Defaults to gpt-4o — chosen over
 * gpt-4o-mini for reliable adherence to negative constraints (single-question
 * discipline, exact language mirroring) and Mom Test methodology nuance.
 */
export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o'

/**
 * Fast/cheap model for background classification work — isolated guard
 * checkers (pass/fail quality checks) and the vagueness classifier. These
 * are single-turn yes/no judgments over one message, not open-ended
 * generation, so gpt-4o-mini is reliable here at a fraction of the cost.
 */
export const OPENAI_FAST_MODEL = process.env.OPENAI_FAST_MODEL || 'gpt-4o-mini'
