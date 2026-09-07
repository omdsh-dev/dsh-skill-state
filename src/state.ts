/** Pure state model and reducers for SKILL.state. */
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { ToolExecution, ToolExecutionResult } from "@deepseek-ai/dsh-tools";

import type { ResolvedConfig } from "./config.ts";

/** One plan item in the canonical execution state. */
export interface PlanItem {
  id: string;
  description: string;
  status: "todo" | "doing" | "done" | "blocked";
}
/** The structured execution state projected into each model request. */
export interface SkillState {
  task: { goal: string; constraints: string[]; acceptanceCriteria: string[] };
  plan: PlanItem[];
  repository: { branch?: string; changedFiles: string[]; importantFiles: string[] };
  decisions: { decision: string; reason?: string }[];
  facts: string[];
  verification: { lastCommand?: string; status: "unknown" | "pass" | "fail"; errors: string[] };
  blockers: string[];
  nextAction?: string;
}
/** A validated semantic mutation supplied by the model or an environment reducer. */
export type SkillStatePatch = Partial<{
  task: Partial<SkillState["task"]>;
  plan: PlanItem[];
  repository: Partial<{ branch: string | null; changedFiles: string[]; importantFiles: string[] }>;
  decisions: SkillState["decisions"];
  facts: string[];
  verification: Partial<SkillState["verification"]>;
  blockers: string[];
  nextAction: string | null;
}>;
/** Event payload written to the DSH session log. */
export interface SkillStateEventData {
  state: SkillState;
  patch: SkillStatePatch;
  source: "agent" | "reducer";
}

declare module "@deepseek-ai/dsh-session/types" {
  interface SessionEventMap {
    /** One validated canonical state transition. */
    "skill-state/update": SkillStateEventData;
  }
}

export type SkillStateEvent = Extract<SessionEvent, { type: "skill-state/update" }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const knownKeys = (value: Record<string, unknown>, keys: readonly string[], path: string): void => {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`${path}.${key} is not supported`);
};
const stringValue = (value: unknown, path: string): string => {
  if (typeof value !== "string") throw new TypeError(`${path} must be a string`);
  return value;
};
const nullableString = (value: unknown, path: string): string | null =>
  value === null ? null : stringValue(value, path);
const stringArray = (value: unknown, path: string): string[] => {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((item, index) => stringValue(item, `${path}[${index}]`));
};

/** Validate the JSON boundary used by state_patch before applying a mutation. */
export function normalizePatch(input: unknown): SkillStatePatch {
  if (!isRecord(input)) throw new TypeError("patch must be an object");
  knownKeys(
    input,
    ["task", "plan", "repository", "decisions", "facts", "verification", "blockers", "nextAction"],
    "patch",
  );
  const output: SkillStatePatch = {};
  if (input.task !== undefined) {
    if (!isRecord(input.task)) throw new TypeError("patch.task must be an object");
    knownKeys(input.task, ["goal", "constraints", "acceptanceCriteria"], "patch.task");
    const task: NonNullable<SkillStatePatch["task"]> = {};
    if (input.task.goal !== undefined) task.goal = stringValue(input.task.goal, "patch.task.goal");
    if (input.task.constraints !== undefined)
      task.constraints = stringArray(input.task.constraints, "patch.task.constraints");
    if (input.task.acceptanceCriteria !== undefined)
      task.acceptanceCriteria = stringArray(input.task.acceptanceCriteria, "patch.task.acceptanceCriteria");
    output.task = task;
  }
  if (input.plan !== undefined) {
    if (!Array.isArray(input.plan)) throw new TypeError("patch.plan must be an array");
    output.plan = input.plan.map((item, index) => {
      if (!isRecord(item)) throw new TypeError(`patch.plan[${index}] must be an object`);
      knownKeys(item, ["id", "description", "status"], `patch.plan[${index}]`);
      const status = stringValue(item.status, `patch.plan[${index}].status`);
      if (!(["todo", "doing", "done", "blocked"] as string[]).includes(status))
        throw new TypeError(`patch.plan[${index}].status is invalid`);
      return {
        id: stringValue(item.id, `patch.plan[${index}].id`),
        description: stringValue(item.description, `patch.plan[${index}].description`),
        status: status as PlanItem["status"],
      };
    });
  }
  if (input.repository !== undefined) {
    if (!isRecord(input.repository)) throw new TypeError("patch.repository must be an object");
    knownKeys(input.repository, ["branch", "changedFiles", "importantFiles"], "patch.repository");
    const repository: NonNullable<SkillStatePatch["repository"]> = {};
    if (input.repository.branch !== undefined)
      repository.branch = nullableString(input.repository.branch, "patch.repository.branch");
    if (input.repository.changedFiles !== undefined)
      repository.changedFiles = stringArray(input.repository.changedFiles, "patch.repository.changedFiles");
    if (input.repository.importantFiles !== undefined)
      repository.importantFiles = stringArray(input.repository.importantFiles, "patch.repository.importantFiles");
    output.repository = repository;
  }
  if (input.decisions !== undefined) {
    if (!Array.isArray(input.decisions)) throw new TypeError("patch.decisions must be an array");
    output.decisions = input.decisions.map((item, index) => {
      if (!isRecord(item)) throw new TypeError(`patch.decisions[${index}] must be an object`);
      knownKeys(item, ["decision", "reason"], `patch.decisions[${index}]`);
      const decision: { decision: string; reason?: string } = {
        decision: stringValue(item.decision, `patch.decisions[${index}].decision`),
      };
      if (item.reason !== undefined) decision.reason = stringValue(item.reason, `patch.decisions[${index}].reason`);
      return decision;
    });
  }
  if (input.facts !== undefined) output.facts = stringArray(input.facts, "patch.facts");
  if (input.verification !== undefined) {
    if (!isRecord(input.verification)) throw new TypeError("patch.verification must be an object");
    knownKeys(input.verification, ["lastCommand", "status", "errors"], "patch.verification");
    const verification: NonNullable<SkillStatePatch["verification"]> = {};
    if (input.verification.lastCommand !== undefined)
      verification.lastCommand = stringValue(input.verification.lastCommand, "patch.verification.lastCommand");
    if (input.verification.status !== undefined) {
      const status = stringValue(input.verification.status, "patch.verification.status");
      if (!(["unknown", "pass", "fail"] as string[]).includes(status))
        throw new TypeError("patch.verification.status is invalid");
      verification.status = status as SkillState["verification"]["status"];
    }
    if (input.verification.errors !== undefined)
      verification.errors = stringArray(input.verification.errors, "patch.verification.errors");
    output.verification = verification;
  }
  if (input.blockers !== undefined) output.blockers = stringArray(input.blockers, "patch.blockers");
  if (input.nextAction !== undefined) output.nextAction = nullableString(input.nextAction, "patch.nextAction");
  return output;
}

/** Create the empty state used for a new Agent. */
export function emptyState(): SkillState {
  return {
    task: { goal: "", constraints: [], acceptanceCriteria: [] },
    plan: [],
    repository: { changedFiles: [], importantFiles: [] },
    decisions: [],
    facts: [],
    verification: { status: "unknown", errors: [] },
    blockers: [],
  };
}
const copy = <T>(value: T): T => structuredClone(value);
const boundedUnique = (values: readonly string[], limit: number): string[] =>
  [...new Set(values.filter(Boolean))].slice(-limit);

/** Apply dictionary-merge semantics with replacement arrays and bounds. */
export function applyPatch(previous: SkillState, patch: SkillStatePatch, config: ResolvedConfig): SkillState {
  const repository: SkillState["repository"] = {
    changedFiles: patch.repository?.changedFiles ?? previous.repository.changedFiles,
    importantFiles: patch.repository?.importantFiles ?? previous.repository.importantFiles,
  };
  const branch = patch.repository?.branch;
  if (branch !== null && branch !== undefined) repository.branch = branch;
  else if (branch === undefined && previous.repository.branch !== undefined)
    repository.branch = previous.repository.branch;
  const next: SkillState = {
    ...previous,
    task: { ...previous.task, ...patch.task },
    plan: patch.plan ?? previous.plan,
    repository,
    decisions: patch.decisions ?? previous.decisions,
    facts: patch.facts ?? previous.facts,
    verification: { ...previous.verification, ...patch.verification },
    blockers: patch.blockers ?? previous.blockers,
  };
  if (patch.nextAction === null) delete next.nextAction;
  else if (patch.nextAction !== undefined) next.nextAction = patch.nextAction;
  next.task.constraints = boundedUnique(next.task.constraints, config.maxFacts);
  next.task.acceptanceCriteria = boundedUnique(next.task.acceptanceCriteria, config.maxFacts);
  next.plan = next.plan.slice(-config.maxPlanItems);
  next.decisions = next.decisions.slice(-config.maxDecisions);
  next.facts = boundedUnique(next.facts, config.maxFacts);
  next.blockers = boundedUnique(next.blockers, config.maxFacts);
  next.repository.changedFiles = boundedUnique(next.repository.changedFiles, config.maxFacts);
  next.repository.importantFiles = boundedUnique(next.repository.importantFiles, config.maxFacts);
  next.verification.errors = boundedUnique(next.verification.errors, config.maxErrors);
  return copy(next);
}

/** Derive only verified environment facts from a tool result. */
export function deriveToolPatch(
  exec: Pick<ToolExecution, "name" | "arguments">,
  result: ToolExecutionResult,
): SkillStatePatch | undefined {
  const args =
    typeof exec.arguments === "object" && exec.arguments !== null ? (exec.arguments as Record<string, unknown>) : {};
  const command = typeof args.command === "string" ? args.command : exec.name;
  const lower = command.toLowerCase();
  const text = result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  if (/(^|\b)(test|pytest|vitest|jest|ava|mocha|cargo test|go test)(\b|$)/i.test(lower))
    return {
      verification: {
        lastCommand: command,
        status: result.isError ? "fail" : "pass",
        errors: result.isError ? [result.error.message] : [],
      },
    };
  if (result.isError) return undefined;
  if (lower.includes("git status")) {
    const changedFiles = text
      .split("\n")
      .map((line) => line.replace(/^\s*[MADRCU?!]+\s+/, "").trim())
      .filter((line) => line.length > 0 && !line.startsWith("On branch "));
    return { repository: { changedFiles }, facts: [`已执行 ${command}`] };
  }
  if (lower.includes("git branch") && text.trim().length > 0) {
    const branch =
      text
        .split("\n")
        .find((line) => line.startsWith("* "))
        ?.slice(2)
        .trim() ?? text.trim();
    return { repository: { branch }, facts: [`当前分支为 ${branch}`] };
  }
  const toolName = exec.name.toLowerCase();
  if (toolName.includes("write") || toolName.includes("edit") || toolName.includes("patch")) {
    const path = typeof args.path === "string" ? args.path : typeof args.file === "string" ? args.file : undefined;
    return path === undefined ? undefined : { repository: { changedFiles: [path] } };
  }
  return undefined;
}

/** Fold the last persisted Skill State event from a session. */
export function foldState(events: readonly SessionEvent[]): SkillState {
  let state = emptyState();
  for (const event of events)
    if (event.type === "skill-state/update") state = copy((event as SkillStateEvent).data.state);
  return state;
}

/** Re-export the host Agent type for downstream type consumers. */
export type SkillStateAgent = Agent;
