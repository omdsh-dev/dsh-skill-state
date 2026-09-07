# dsh-skill-state

`@deepseek-ai/dsh-skill-state` 是一个可直接安装到 DeepSeek Harness（DSH）的运行时插件。它把长程 Agent 的工作记忆从不断增长的对话历史改成一个可验证、可持久化、受容量限制的结构化执行状态。

本插件依据论文 [SKILL.state: Scalable Long-Horizon Agent Skills](https://arxiv.org/abs/2608.26263) 的运行时模型实现。论文定义每一步的模型输入为：

```text
A_t = (P, Σ_t, O_t)

P   不变的 Skill 规范
Σ_t 当前结构化执行状态
O_t 最新环境观察
```

模型产生临时 reasoning、状态变化和动作：

```text
(R_t, ΔΣ_t, a_t)
```

DSH 插件只保留经过验证的 `ΔΣ_t`，把它应用到 `Σ_t`，然后继续执行 `a_t`。旧的 reasoning、旧的 observation 和完整工具日志仍由 DSH session 保存用于审计；本插件不会把它们复制到长期 State，模型侧新增的 Runtime State 只包含当前投影。

## 安装

这是一个标准 DSH bundle，包含 `package.json` 中的 `dsh.bundle.patch` 和已构建的 `lib/`。使用 DSH CLI 安装到 Web 或 TUI profile：

```sh
npx -y @deepseek-ai/dsh plugin --profile web add github:omdsh-dev/dsh-skill-state
npx -y @deepseek-ai/dsh --profile web
# TUI 同样适用：
npx -y @deepseek-ai/dsh plugin --profile tui add github:omdsh-dev/dsh-skill-state
npx -y @deepseek-ai/dsh --profile tui
```

也可以安装本地 checkout：

```sh
npx -y @deepseek-ai/dsh plugin --profile web add /absolute/path/to/dsh-skill-state
```

安装后重启 DSH。Bundle 会挂载 `@deepseek-ai/dsh-skill-state`，并注册 `state_patch` 工具和 Runtime State 上下文。

直接写 profile composition 时，使用：

```yaml
- id: skill-state
  name: '@deepseek-ai/dsh-skill-state'
  config:
    maxFacts: 50
    maxDecisions: 30
    maxPlanItems: 20
    maxErrors: 20
    maxObservationChars: 8000
```

## 插件协议

入口是一个标准 DSH/Cordis function plugin：

```ts
export const name = '@deepseek-ai/dsh-skill-state'
export const inject = ['tools', 'systemPrompt']
export const Config: z<Config>
export function apply(ctx: Context, config?: Config): SkillStateStore
```

插件只使用 DSH 官方扩展面：

- `ctx.systemPrompt.section()` 注册不变的 Skill State 策略。
- `ctx.systemPrompt.context()` 在每次模型请求前投影当前状态和最新 observation。
- `ctx.tools.register(defineTool(...))` 注册 `state_patch`。
- `ctx.on('tools/result', ...)` 观察工具结果并运行环境 reducer。
- `Session.append('skill-state/update', ...)` 把状态转移写进当前 session。

插件不修改 DSH agent loop，不替换工具权限，不创建第二套 conversation history，也不把完整工具输出复制进状态。

## 运行时状态

默认状态结构如下：

```json
{
  "task": {
    "goal": "",
    "constraints": [],
    "acceptanceCriteria": []
  },
  "plan": [],
  "repository": {
    "branch": "",
    "changedFiles": [],
    "importantFiles": []
  },
  "decisions": [],
  "facts": [],
  "verification": {
    "lastCommand": "",
    "status": "unknown",
    "errors": []
  },
  "blockers": [],
  "nextAction": ""
}
```

状态只保存会影响未来行动的信息：目标、约束、验收条件、计划、分支和文件事实、关键决策、验证结果、阻塞条件与下一动作。完整 reasoning、重复日志、无法验证的感觉和长工具输出不属于 State。

每次模型请求都会得到一个 bounded projection。DSH `systemPrompt.context` 的运行时快照语义会让当前投影覆盖之前的同名快照，不会因为每一步都重新注册状态而累积一份新的 State：

```xml
<runtime_state>
{"task":...,"plan":...,"verification":...,"nextAction":"..."}
</runtime_state>
<latest_observation>
最近一次工具结果的文本投影
</latest_observation>
```

`latest_observation` 只保存到下一次请求使用；其完整内容仍来自 DSH 的 session/tool event。这样状态是热数据，审计日志是冷数据。

## state_patch 工具

模型在做出会影响后续步骤的语义判断后调用：

```json
{
  "patch": {
    "task": {
      "goal": "增加 Google OAuth，同时保留邮箱登录",
      "constraints": ["复用现有 JWT session"]
    },
    "decisions": [
      {
        "decision": "复用现有 JWT session",
        "reason": "避免维护两套 session 系统"
      }
    ],
    "nextAction": "检查 OAuth state 校验"
  }
}
```

数组字段是新的权威数组值，不是无界追加。插件会去重和截断数组，确保状态大小不随执行步数增长。对可选字段使用 `null` 可以删除过期值，例如：

```json
{
  "patch": {
    "nextAction": null,
    "repository": { "branch": null }
  }
}
```

一次成功的调用会：

1. 根据字典合并和容量策略计算 `Σ_{t+1}`。
2. 将 `{ patch, state, source }` 追加为 `skill-state/update` session event。
3. 返回更新后的 canonical state，供模型确认结果。

session 恢复时，插件会折叠最近的 `skill-state/update` 事件重建状态。状态事件不会进入普通消息 surface。

## 自动环境 reducer

插件不会让模型再次总结工具日志，而是从 `tools/result` 的可见事实中确定性地更新环境字段：

| 工具结果 | 更新字段 |
| --- | --- |
| `test`、`pytest`、`vitest`、`jest`、`cargo test`、`go test` | `verification.lastCommand/status/errors` |
| `git status` | `repository.changedFiles` 和执行事实 |
| `git branch` | `repository.branch` 和分支事实 |
| 名称包含 `write`、`edit`、`patch` 且带 `path/file` 参数 | `repository.changedFiles` |

其他工具结果只会成为最新 observation，不会自动进入长期 State。模型可以在确认事实后用 `state_patch` 写入语义字段。

## 配置

| 字段 | 默认值 | 作用 |
| --- | ---: | --- |
| `maxFacts` | `50` | facts、约束、验收条件、阻塞项和文件路径的上限 |
| `maxDecisions` | `30` | decisions 的上限 |
| `maxPlanItems` | `20` | plan 的上限 |
| `maxErrors` | `20` | verification.errors 的上限 |
| `maxObservationChars` | `8000` | 最新工具 observation 的字符上限，保留末尾内容 |
| `contextOrder` | `125` | Runtime State prompt context 的顺序 |

前五项必须是正整数。`contextOrder` 必须是有限数字；默认值位于 DSH 内置 runtime context 之后。

## 论文测试场景在 DSH 中的对应关系

仓库测试将论文的 SkillExecBench 诊断场景改写成不依赖外部模型的 DSH State 测试：

| 论文实验 | DSH 测试 | 验证内容 |
| --- | --- | --- |
| 长程扩展 `T=10…200` | 200 步状态循环 | State 数组有界，投影大小保持稳定 |
| Context Corruption | 50 个 telemetry 干扰 observation | 无关观察不会写入长期 State |
| State Recovery：外部移动/修正 | stale fact → corrective patch | 当前事实覆盖未来行动，零额外恢复步 |
| Budget-Matched Controls | 精确 shelf/item/file 标识符 | 结构化关系不会被摘要式压缩删除 |
| Verification reducer | 测试成功与失败结果 | 自动更新 pass/fail、命令和错误 |
| Repository environment | `git status`、`git branch` | 自动更新 changed files 和 branch |

论文报告在 `T=200` 时 SKILL.state 的平均 prompt 仍约为 1,811 字符，而 Memory Summary 达到约 84,364 字符；本插件的测试不伪造论文准确率或 token 数，而是验证 DSH 侧能提供这一结果所需的 bounded state、noise filtering、state recovery 和 deterministic reducer 机制。

## 开发和验证

```sh
pnpm install
pnpm run fmt:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack --dry-run --json
```

`pnpm run build` 会生成可被 DSH bundle 直接加载的 `lib/index.js` 和 `lib/index.d.ts`。`pnpm pack --dry-run --json` 用于确认发布包同时包含 `lib/`、`src/`、`cordis.patch.yml`、README 和许可证。

## 限制

- 论文假设 State schema 足以表示未来决策所需信息；本插件提供面向 coding agent 的通用字段，但具体业务仍应通过 `state_patch` 设计自己的 facts、plan 和 acceptance criteria。
- DSH session 的原始 surface/history 仍由宿主负责保留和压缩；本 bundle 不删除历史消息。它保证新增的 Runtime State 投影有界，并可与 DSH 的 compaction profile 配合使用。
- `latest_observation` 只保留最近一次工具结果，完整审计请读取 DSH session。
- `state_patch` 的 JSON 边界会严格校验字段、数组元素和枚举值；未知字段或非法状态会被拒绝，不会写入 session。
- reducer 只处理可识别的命令和字段；复杂环境必须先用 DSH 工具读取，再用 `state_patch` 写入经过验证的结果。
- 本插件提供 Runtime State Layer，不替换 DSH 的 session persistence、审批、权限、压缩或工具调度策略。

## 许可证

MIT
