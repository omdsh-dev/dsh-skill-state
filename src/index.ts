/** DSH Skill State: bounded structured execution state for long-horizon agents. */
export { Config, resolveConfig, type ResolvedConfig } from "./config.ts";
export { apply } from "./runtime.ts";
export {
  applyPatch,
  deriveToolPatch,
  emptyState,
  foldState,
  normalizePatch,
  type PlanItem,
  type SkillState,
  type SkillStateAgent,
  type SkillStateEventData,
  type SkillStatePatch,
} from "./state.ts";
export { inject, name } from "./plugin.ts";

export { apply as default } from "./runtime.ts";
