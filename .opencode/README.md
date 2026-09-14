# Portable OpenCode workflow

This directory contains a reusable engineering workflow for web, mobile, API,
SaaS, data, and infrastructure repositories. The agents discover the actual
stack and repository conventions before acting.

## Included roles

- `orchestrator`: primary balanced agent; handles cohesive work directly and
  delegates only when specialization or context isolation adds value.
- `research-explorer`: read-only repository and external research.
- `architect`: implementation-ready cross-cutting design.
- `implementer`: bounded implementation in an isolated child session.
- `test-debugger`: evidence-based diagnosis without edits.
- `reviewer`: independent correctness and regression review.
- `browser-qa`: live browser checks through Playwright MCP.
- `security-reviewer`: focused review of sensitive trust boundaries.

The matching commands are available as `/work`, `/research`, `/design`,
`/implement`, `/debug`, `/review`, `/qa`, and `/security`.

## Reusing in another repository

1. Copy `.opencode/agents/`, `.opencode/commands/`, `.opencode/README.md`,
   `opencode.json`, and the `.artifacts/` ignore rule. Do not copy
   `.opencode/package.json`, lockfiles, `node_modules/`, or other local state.
2. Create a project-specific `AGENTS.md` or run `/init`. Do not reuse another
   project's architecture, commands, or security constraints unchanged.
3. Run `opencode models opencode` and update agent model IDs if the target
   account does not provide `opencode/gpt-5.6-sol` and
   `opencode/muse-spark-1.3`.
4. Restart OpenCode because configuration, agents, commands, and MCP servers
   are loaded only at startup.
5. Verify with `opencode agent list` and `opencode mcp list`.

The excluded `.opencode` files are managed locally by OpenCode and are not part
of the portable set.

## Browser QA

`opencode.json` starts `@playwright/mcp@0.0.80` with an isolated browser profile
and stores artifacts under `.artifacts/playwright`. Playwright tools are denied
globally and enabled only for `browser-qa`; arbitrary server-side Playwright
code execution remains denied. Use test accounts and local, preview, or staging
environments rather than production.

Playwright MCP is appropriate for persistent exploratory interaction. For
high-volume scripted checks, the official `@playwright/cli` skills are a more
token-efficient optional alternative.

## Native mobile QA with Maestro

Playwright covers web applications, PWAs, responsive layouts, and browser-based
mobile emulation. For native Android or iOS applications, install Maestro and
add this optional server to `opencode.json`:

```json
{
  "mcp": {
    "maestro": {
      "type": "local",
      "command": ["maestro", "mcp"],
      "enabled": true,
      "timeout": 30000
    }
  },
  "permission": {
    "maestro_*": "deny"
  }
}
```

Create a dedicated `mobile-qa` subagent that starts with `"*": deny`, allows
only the required repository tools and `maestro_*`, and denies cloud execution
unless explicitly requested. Maestro requires Java and a running emulator,
simulator, or connected test device, so it is not enabled in the base config.
