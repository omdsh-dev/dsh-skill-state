import type { ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import { describe, expect, it } from "vitest";

import { SkillStateStore } from "../src/runtime.ts";
import { applyPatch, deriveToolPatch, emptyState, normalizePatch } from "../src/state.ts";
import type { SkillState } from "../src/state.ts";

const config = {
  maxFacts: 2,
  maxDecisions: 2,
  maxPlanItems: 2,
  maxErrors: 2,
  maxObservationChars: 8_000,
  contextOrder: 125,
};
const success = (text = "ok"): ToolExecutionResult => ({
  isError: false,
  value: {},
  content: [{ type: "text", text }],
});
const failure: ToolExecutionResult = {
  isError: true,
  error: { message: "test failed" },
  content: [{ type: "text", text: "failed" }],
};

function warehouseState(): SkillState {
  return { ...emptyState(), task: { goal: "处理订单", constraints: [], acceptanceCriteria: ["库存准确"] } };
}

describe("SKILL.state paper scenarios", () => {
  it("keeps a 200-step execution state bounded like the O(1) prompt design", () => {
    let state = warehouseState();
    for (let step = 0; step < 200; step += 1) {
      state = applyPatch(
        state,
        {
          facts: [...state.facts, `shelf_${step}: item_${step}`],
          decisions: [...state.decisions, { decision: `store item_${step}` }],
          plan: [{ id: "warehouse", description: "继续处理订单", status: "doing" }],
          nextAction: `处理第 ${step + 1} 个订单`,
        },
        config,
      );
    }
    expect(state.facts).toHaveLength(2);
    expect(state.decisions).toHaveLength(2);
    expect(state.plan).toHaveLength(1);
    expect(JSON.stringify(state).length).toBeLessThan(1_800);
  });

  it("filters high-rate distractor observations instead of persisting noise", () => {
    let state = warehouseState();
    for (let event = 0; event < 50; event += 1) {
      const patch = deriveToolPatch(
        { name: "telemetry", arguments: { event: `background-${event}` } },
        success("unrelated telemetry"),
      );
      expect(patch).toBeUndefined();
      if (patch !== undefined) state = applyPatch(state, patch, config);
    }
    expect(state.facts).toEqual([]);
    expect(state.verification.status).toBe("unknown");
  });

  it("recovers from external world drift in zero extra turns", () => {
    const stale = applyPatch(warehouseState(), { facts: ["item_A 在 shelf_5"] }, config);
    const corrected = applyPatch(
      stale,
      { facts: ["item_A 在 shelf_8"], nextAction: "从 shelf_8 继续处理 item_A" },
      config,
    );
    expect(corrected.facts).toEqual(["item_A 在 shelf_8"]);
    expect(corrected.nextAction).toContain("shelf_8");
    const deleted = applyPatch(corrected, { nextAction: null, repository: { branch: null } }, config);
    expect(deleted.nextAction).toBeUndefined();
    expect(deleted.repository.branch).toBeUndefined();
  });

  it("preserves exact relational identifiers that budget compression would remove", () => {
    const state = applyPatch(
      warehouseState(),
      {
        repository: { changedFiles: ["src/auth/callback.ts"], importantFiles: ["src/auth/session.ts"] },
        facts: ["item_382 在 shelf_103"],
        decisions: [{ decision: "发货 item_382", reason: "订单已确认" }],
      },
      config,
    );
    expect(state.facts).toContain("item_382 在 shelf_103");
    expect(state.repository.changedFiles).toContain("src/auth/callback.ts");
    expect(state.decisions[0]?.decision).toBe("发货 item_382");
  });

  it("rejects malformed or unknown state fields at the tool boundary", () => {
    expect(() => normalizePatch({ facts: ["verified"], unknown: true })).toThrow("patch.unknown");
    expect(() => normalizePatch({ plan: [{ id: "step", description: "bad", status: "running" }] })).toThrow(
      "status is invalid",
    );
    expect(normalizePatch({ nextAction: null, repository: { branch: "main" } })).toEqual({
      nextAction: null,
      repository: { branch: "main" },
    });
  });

  it("bounds the latest observation projection", () => {
    const store = new SkillStateStore({ ...config, maxObservationChars: 8 });
    const agent = { id: "observation-agent" } as never;
    store.observe(agent, { content: [{ type: "text", text: "a very long tool output" }] });
    expect(store.observation(agent)).toBe("l output");
  });
});

describe("environment reducers", () => {
  it("records pass and fail verification results", () => {
    expect(deriveToolPatch({ name: "bash", arguments: { command: "pnpm test" } }, success("3 passed"))).toEqual({
      verification: { lastCommand: "pnpm test", status: "pass", errors: [] },
    });
    expect(deriveToolPatch({ name: "terminal", arguments: { command: "pytest tests" } }, failure)).toEqual({
      verification: { lastCommand: "pytest tests", status: "fail", errors: ["test failed"] },
    });
  });

  it("extracts repository changes and branch facts", () => {
    expect(
      deriveToolPatch(
        { name: "bash", arguments: { command: "git status --short" } },
        success(" M src/index.ts\n?? tests/index.spec.ts"),
      ),
    ).toEqual({
      repository: { changedFiles: ["src/index.ts", "tests/index.spec.ts"] },
      facts: ["已执行 git status --short"],
    });
    expect(
      deriveToolPatch({ name: "bash", arguments: { command: "git branch --show-current" } }, success("feature/state")),
    ).toEqual({ repository: { branch: "feature/state" }, facts: ["当前分支为 feature/state"] });
    expect(deriveToolPatch({ name: "bash", arguments: { command: "git status --short" } }, failure)).toBeUndefined();
  });
});
