/**
 * The patient's quick check (teach-back). The screen shows three answers per
 * question and sends the keys of the ones the patient chose; the server scores
 * them here so a patient cannot send a made-up result.
 */
export const TEACH_BACK_KEYS = {
  q1: ['q1a', 'q1b', 'q1c'],
  q2: ['q2a', 'q2b', 'q2c'],
} as const;

export type Q1Answer = (typeof TEACH_BACK_KEYS.q1)[number];
export type Q2Answer = (typeof TEACH_BACK_KEYS.q2)[number];
export interface TeachBackAnswers { q1: Q1Answer; q2: Q2Answer }

/**
 * The correct answers:
 * - q1 'q1b': "It means we need a closer check. It is not a diagnosis."
 * - q2 'q2a': "Follow the next step with my care team."
 */
export const CORRECT_ANSWERS: Readonly<TeachBackAnswers> = { q1: 'q1b', q2: 'q2a' };

/** Scores the chosen keys. Throws for a key the screen does not show. */
export function scoreTeachBack(answers: { q1: string; q2: string }): { understoodQ1: boolean; understoodQ2: boolean } {
  if (!(TEACH_BACK_KEYS.q1 as readonly string[]).includes(answers.q1) || !(TEACH_BACK_KEYS.q2 as readonly string[]).includes(answers.q2)) {
    throw new Error('Choose one of the answers shown.');
  }
  return { understoodQ1: answers.q1 === CORRECT_ANSWERS.q1, understoodQ2: answers.q2 === CORRECT_ANSWERS.q2 };
}
