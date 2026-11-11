---
source-hash: c9ea01f295ab353874603e3f7bb6154bfb34dccbd37d5d34f340b5c0b7fa9e64
---

# Performance

## Measure your application

Measure a representative route and interaction in a production build of your application. Run `pnpm exec meeko build .` from the project root and serve that build with `pnpm exec meeko preview .`. Repeat the same journey in the same browser and machine before and after the change; record the revision, environment and measurements. The browser Performance and Network tools can show loading, hydration, requests and transferred size.

## Optimize with evidence

Identify the slowest part first: server response, download, client execution or interaction after hydration. Reduce work or data in that part and measure the same journey again. Check that the interaction and initial HTML still work; a smaller bundle alone does not establish a better user experience.

The [Meeko benchmarks](benchmarks.md) and repository budget use a small fixed scenario. Their figures do not predict your application's performance.

## Repository budget

### Reproducible measurement

See [reproducible measurement in the contributor guide](contributing.md#reproducible-measurement).

### Metric categories

See [metric categories in the contributor guide](contributing.md#metric-categories).

### Budgets and comparison

See [budgets and comparison in the contributor guide](contributing.md#budgets-and-comparison).

### Updating a baseline

See [updating a baseline in the contributor guide](contributing.md#updating-a-baseline).
