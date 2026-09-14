---
description: Independently review the current diff and validation evidence in a child session.
agent: reviewer
subtask: true
---

Review the current repository diff against these acceptance criteria and the detected web, mobile, backend, data, or infrastructure boundaries: $ARGUMENTS

Report only actionable findings in severity order with precise file and line or symbol references, concrete failure scenarios, minimal corrections, and missing tests. If there are no findings, say so and separately list residual validation gaps. Do not edit files.

After the reviewer child returns, relay its report and stop. Do not fix findings in this command.
