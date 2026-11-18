# Meeko agent skill

Teaches AI coding agents (Claude Code, Codex and any tool that reads Agent Skills) to write correct Meeko code: `.meeko` components, signals, SSR and hydration, Meeko Framework routing and server APIs, and the `meeko` CLI.

The skill loads automatically when a project contains `.meeko` files, `meeko.config.ts` or `@meekojs/*` dependencies.

## Install

### Claude Code (plugin)

```text
/plugin marketplace add meekojs/meeko
/plugin install meeko@meeko
```

To install it for everyone on a project, commit the marketplace in `.claude/settings.json`:

```json
{
	"extraKnownMarketplaces": {
		"meeko": { "source": { "source": "github", "repo": "meekojs/meeko" } }
	},
	"enabledPlugins": { "meeko@meeko": true }
}
```

### Other agents (copy the skill)

The skill is a plain folder: `skills/meeko/` with `SKILL.md` and `references/`. Copy it into your agent's skills directory, for example `.claude/skills/meeko/` for Claude Code without plugins, or the skills directory documented by your agent. For agents without skill support, point `AGENTS.md` at `skills/meeko/SKILL.md`.

## Contents

| File                                | Covers                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `SKILL.md`                          | Core rules, minimal component, validation workflow, mistakes from Vue/Svelte/React |
| `references/components.md`          | SFC structure, macros, every template directive                                    |
| `references/reactivity.md`          | Signals, computed, effects, lifecycle, context, SSR semantics                      |
| `references/components-advanced.md` | Styles, built-in components, dynamic components                                    |
| `references/framework-routing.md`   | Pages, `definePage`, render modes, data, layouts, middleware, navigation           |
| `references/framework-server.md`    | `meeko.config.ts`, API, RPC, sessions, WebSockets, adapters, deploy                |
| `references/tooling.md`             | CLI, MEEK diagnostics, Vite, UI/i18n/icon packages, lint, tests, migrations        |

## Maintenance

The skill targets `@meekojs/meeko` 1.9 and is distilled from `docs/en`. When a release changes public syntax or APIs, update the matching reference and bump `version` in `.claude-plugin/plugin.json` alongside the core package.
