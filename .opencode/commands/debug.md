---
description: Reproduce and diagnose a failing test, build, runtime, or CI job in a child session.
agent: test-debugger
subtask: true
---

Diagnose this test, build, runtime, device, browser, infrastructure, or CI failure without editing files: $ARGUMENTS

Reproduce it narrowly, identify the first causal defect, distinguish code failures from environment failures, rule out credible alternatives, and return a minimal repair brief plus exact post-fix validation commands.

After the diagnostic child returns, relay its report and stop. Do not apply the proposed repair in this command.
