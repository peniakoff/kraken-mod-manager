---
description: Perform a focused security review of the current diff or a named trust boundary in a child session.
agent: security-reviewer
subtask: true
---

Perform a focused security review of this change or boundary: $ARGUMENTS

Inspect the actual diff and adjacent call paths. Report only evidence-backed vulnerabilities or material defense gaps, ordered by severity, with attack prerequisites, impact, precise code references, minimal corrections, and regression tests. Do not edit files.

After the security child returns, relay its report and stop. Do not fix findings in this command.
