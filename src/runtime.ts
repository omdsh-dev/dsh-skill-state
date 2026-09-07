/** Cordis runtime integration for the SKILL.state model. */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";

import type { Config, ResolvedConfig } from "./config.ts";
import { resolveConfig } from "./config.ts";
import {
  applyPatch,
  deriveToolPatch,
  foldState,
  normalizePatch,
  type SkillState,
  type SkillStatePatch,
} from "./state.ts";

/** Runtime store owned by one plugin fiber. */
export class SkillStateStore {
  private readonly states = new Map<string, SkillState>();
  private readonly observations = new Map<string, string>();
  constructor(private readonly config: ResolvedConfig) {}
  /** Return a detached state snapshot for one live Agent. */
  get(agent: Agent): SkillState {
    const id = String(agent.id);
    let state = this.states.get(id);
    if (state === undefined) {
      state = foldState(agent.session.events);
      this.states.set(id, state);
    }
    return structuredClone(state);
  }
  /** Apply a patch and publish one durable event after the state is valid. */
  patch(agent: Agent, patch: SkillStatePatch, source: "agent" | "reducer" = "agent"): SkillState {
    const state = applyPatch(this.get(agent), patch, this.config);
    agent.session.append("skill-state/update", { state, patch: structuredClone(patch), source });
    this.states.set(String(agent.id), state);
    return structuredClone(state);
  }

  /** Keep only the latest tool observation; the session log remains its source of truth. */
  observe(agent: Agent, result: { content: readonly { type: string; text?: string }[] }): void {
    const text = result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n");
    this.observations.set(String(agent.id), text.slice(-this.config.maxObservationChars));
  }

  /** Return the latest observation for the next model request. */
  observation(agent: Agent): string {
    return this.observations.get(String(agent.id)) ?? "";
  }
}

const stateSchema = { type: "object" as const, additionalProperties: true, properties: {} };

/** Mount prompt projection, state_patch, and automatic environment reducers. */
export function apply(ctx: Context, config: Config = {}): SkillStateStore {
  const resolved = resolveConfig(config);
  const store = new SkillStateStore(resolved);
  ctx.systemPrompt.section({
    name: "skill-state:policy",
    order: 19,
    text: "Skill State 是当前执行的唯一权威状态。只保存经过工具结果或用户确认的、会影响未来行动的信息；不要把旧 reasoning 或完整日志复制进状态。状态超过容量时应删除不再影响未来决策的条目。",
  });
  ctx.systemPrompt.context({
    name: "skill-state:runtime",
    order: resolved.contextOrder,
    text: ({ agent }) =>
      agent === undefined
        ? ""
        : `<runtime_state>\n${JSON.stringify(store.get(agent))}\n</runtime_state>\n<latest_observation>\n${store.observation(agent)}\n</latest_observation>`,
  });
  ctx.tools.register(
    defineTool({
      name: "state_patch",
      description:
        "将会影响后续行动的目标、计划、决策、事实、验证结果、阻塞项或下一动作写入结构化运行状态。只提交增量后的权威数组值，不要写入推理过程或完整日志。",
      parameters: { patch: { type: "object", required: true, additionalProperties: true, properties: {} } },
      output: { schema: stateSchema, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
      execute(args, execution) {
        if (execution.agent === undefined) throw new Error("state_patch requires an agent execution context");
        return Promise.resolve(
          store.patch(execution.agent, normalizePatch(args.patch)) as unknown as Record<string, unknown>,
        );
      },
    }),
  );
  ctx.on("tools/result", (execution: ToolExecution, result) => {
    if (execution.agent === undefined || execution.name === "state_patch") return;
    store.observe(execution.agent, result);
    const patch = deriveToolPatch(execution, result);
    if (patch !== undefined) store.patch(execution.agent, patch, "reducer");
  });
  return store;
}
