/** Plugin configuration and validated defaults. */
import z from "@deepseek-ai/schemastery";

/** Serializable deployment configuration. */
export interface Config {
  /** Maximum number of facts and repository paths retained in hot state. */
  maxFacts?: number;
  /** Maximum number of semantic decisions retained in hot state. */
  maxDecisions?: number;
  /** Maximum number of plan rows retained in hot state. */
  maxPlanItems?: number;
  /** Maximum number of verification errors retained in hot state. */
  maxErrors?: number;
  /** Maximum characters retained from the latest tool observation. */
  maxObservationChars?: number;
  /** Dynamic prompt context order. */
  contextOrder?: number;
}

/** Configuration after defaults and direct-call validation. */
export interface ResolvedConfig {
  maxFacts: number;
  maxDecisions: number;
  maxPlanItems: number;
  maxErrors: number;
  maxObservationChars: number;
  contextOrder: number;
}

/** Loader-visible configuration schema. */
export const Config: z<Config> = z.object({
  maxFacts: z.number().step(1).min(1).default(50),
  maxDecisions: z.number().step(1).min(1).default(30),
  maxPlanItems: z.number().step(1).min(1).default(20),
  maxErrors: z.number().step(1).min(1).default(20),
  maxObservationChars: z.number().step(1).min(1).default(8_000),
  contextOrder: z.number().default(125),
});

/** Resolve and validate defaults for callers that bypass Loader. */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const resolved: ResolvedConfig = {
    maxFacts: config.maxFacts ?? 50,
    maxDecisions: config.maxDecisions ?? 30,
    maxPlanItems: config.maxPlanItems ?? 20,
    maxErrors: config.maxErrors ?? 20,
    maxObservationChars: config.maxObservationChars ?? 8_000,
    contextOrder: config.contextOrder ?? 125,
  };
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isFinite(value) || (key !== "contextOrder" && (!Number.isSafeInteger(value) || value < 1))) {
      throw new TypeError(`${key} is invalid`);
    }
  }
  return resolved;
}
