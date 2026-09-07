import { describe, expect, it } from "vitest";

import { Config, inject, name } from "../src/index.ts";

describe("DSH function-plugin contract", () => {
  it("exports stable Loader metadata and required service injection", () => {
    expect(name).toBe("@deepseek-ai/dsh-skill-state");
    expect(inject).toEqual(["tools", "systemPrompt"]);
    expect(Config).toBeDefined();
  });
});
