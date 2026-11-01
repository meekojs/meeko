---
source-hash: c21a6c4e57510c2abb08fcc0681ea31ad53d72cdb39a68dd8be2bc84628e15ca
---

# Performance

## Reproducible measurement

From the monorepo root, with Node.js 24+ and Chrome installed:

```powershell
pnpm -F @meekojs/meeko benchmark:measure
pnpm -F @meekojs/meeko benchmark:compare --fail-on-regression
```

`benchmark:measure` builds the core and generates `packages/meeko/.meeko/performance/current.json`. `benchmark:compare` writes `comparison.json` in the same folder. `benchmark:budget` runs both steps and returns a nonzero code if it detects a comparable regression. No command updates the baseline automatically.

The scenario uses a fixed component with a counter and 30 rows, checks SSR and verifies a click after hydration in Chromium. It does not represent the size or latency of a complete user application. Reports record Node, browser and esbuild versions, platform, architecture, CPU, Git revision, dirty state and scenario hash.

## Metric categories

| Metric                      | What it measures                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `compile.cold`              | First compilation in a new worker; excludes starting the worker and importing the compiler.     |
| `compile.warm`              | Full compilations of the modified component after warmup; does not assume an incremental cache. |
| `ssr.render`                | Complete `renderWithState` of a new instance.                                                   |
| `client.hydration`          | Time inside `hydrate` in a real browser; the button event is checked afterward.                 |
| `bundle.raw`, `bundle.gzip` | Scenario client bytes, compiled and minified with esbuild, without a sourcemap.                 |
| `lsp.completion.cold`       | First completion in a newly created LSP project; excludes initial discovery.                    |
| `lsp.completion.warm`       | Repeated completions in that document, with the TypeScript program prepared.                    |

The LSP works with a small temporary application and `dist` types, not the complexity of a real consumer. Filesystems and operating system caches may be warm even when creating a new worker or service. The median and p95 are calculated over all samples, without removing outliers. There are seven rounds and two warmups; cold measurements use three new instances. You can change these with `--rounds`, `--warmups` and `--cold-rounds`.

To use Chromium downloaded by Playwright, set `MEEKO_BROWSER_CHANNEL=chromium`. For your own executable, use `MEEKO_CHROME_PATH`. The runner releases its browser, server and temporary folder when finished. It does not run the editor or modify consumer projects.

## Budgets and comparison

`packages/meeko/benchmarks/performance-budgets.json` defines the allowed relative increase and a minimum absolute increase per unit or metric. Initial values are 35% and 0.05 ms for timings, 5% and 256 bytes for sizes. Cold compilation and completion have specific minimums to avoid blocking on small variations.

A regression must exceed both limits in **median and p95**. A single slow sample is not enough. Timings only block when Node, platform, architecture, CPU and browser version match; another environment appears as `different-environment`. Sizes are always compared because they do not depend on the clock. A different scenario, a missing metric or a changed unit rejects the comparison instead of declaring success.

CI runs `benchmark:budget` and preserves reports even on failure. On a runner different from the machine that captured the baseline, timings remain informational and sizes still count against the budget. To evaluate a timing regression between revisions, measure both on the same runner with the same tool; avoid imposing universal absolute numbers.

## Updating a baseline

The versioned baseline is `packages/meeko/benchmarks/performance-baseline.json`. After reviewing a scenario change, tool version change or deliberate cost:

```powershell
pnpm -F @meekojs/meeko benchmark:measure
Copy-Item packages/meeko/.meeko/performance/current.json packages/meeko/benchmarks/performance-baseline.json
```

Review the report's differences alongside the change that justifies the new cost. The comparator accepts `--baseline`, `--current`, `--budgets` and `--output` to compare other captures without replacing the reference. If the measured work changes, update the scenario version as well as its source so the hash prevents comparing different workloads.

The historical benchmarks `benchmark`, `benchmark:scenarios` and `benchmarks/stability-baseline.mjs` remain available for broader comparisons, memory, HMR and external consumers. This small budget is an additional signal; it does not replace functional tests or a representative consumer measurement.
