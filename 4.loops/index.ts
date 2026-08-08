/**
 * 4.loops — public surface of the zero-prompt healing loop.
 * `ZeroPromptHealer` is the canonical name (alias of the Healer class).
 */
export { Healer, Healer as ZeroPromptHealer, healer, heal, executeAndHeal } from './healer.ts';
export type {
  HealerConfig,
  HealingSession,
  HealingAttempt,
  HealingResult,
  ErrorContext,
} from './healer.ts';
