# `@deepseek-ai/dsh-skill-state`

Mount this plugin in a DSH profile to add bounded structured execution state. It registers `state_patch`, persists `skill-state/update` session events, injects `<runtime_state>` before model calls, and derives verification state from test-like tool results. The full session log remains available for audit and recovery; only the bounded canonical state enters the hot prompt path.
