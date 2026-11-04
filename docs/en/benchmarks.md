---
source-hash: 07450f7c4b4322af6aeaf8df4fd9be3ce13c7a78e3554f9b8efe9049faa82aa2
---

# Reproducible comparison: Meeko and Vue

This test uses the same functional case in both engines: a server-rendered button with initial value `0`, computed value `doble`, hydration and a click that updates both values. The Meeko example is [`Counter.meeko`](../../packages/meeko/examples/counter/Counter.meeko); its Vue counterpart is in [`benchmarks/vue-counter.ts`](../../packages/meeko/benchmarks/vue-counter.ts). Vue uses a handwritten `render` function and its production runtime, without a browser template compiler. Meeko uses the module produced by its compiler. Visible text is checked before and after each click.

## How to reproduce it

In PowerShell 7, with Node.js 24 or later, `pnpm install` and Google Chrome installed:

```powershell
pnpm run benchmark
$env:MEEKO_BENCH_ORDER = 'vue-first'
try { pnpm run benchmark } finally { Remove-Item Env:MEEKO_BENCH_ORDER }
```

The command builds Meeko, generates the example component, checks benchmark types and runs [`benchmarks/run.ts`](../../packages/meeko/benchmarks/run.ts). It does not download Chrome. Set `MEEKO_CHROME_PATH` to use another compatible executable. The full result is emitted as JSON to stdout and includes versions, CPU, execution order and Git status.

## Method

- **Size:** esbuild 0.28.2 bundles each client as ESM `es2022` with `minify`, `treeShaking` and `NODE_ENV=production`. Delivered JS and its gzip size are measured. HTML, CSS, HTTP headers and development dependencies are excluded.
- **SSR:** an instance is created per render. Meeko calls `renderToString`; Vue creates an SSR application and calls [`vue/server-renderer` `renderToString`](https://vuejs.org/api/ssr). There are two warm-up rounds and nine measured rounds of 500 renders. Each figure is the total round time divided by 500; `await` applies to both.
- **Loading:** headless Chrome navigates to two SSR pages served over HTTP on `127.0.0.1`. The time is Navigation Timing's `loadEventEnd - startTime`, with a warm cache after two warm-up navigations. Nine navigations are measured per engine. This local figure does not represent real network loading or Web Vitals.
- **Hydration:** each client measures `performance.now()` immediately before and after Meeko's `hydrate` or Vue's `createSSRApp(...).mount`. The same nine measured navigations are used.
- **Update:** the browser clicks 400 times per round and checks the text after each click. In Vue it waits for `nextTick()` before checking the DOM; Meeko updates without that wait. Two warm-up rounds, nine measured rounds; each result is divided by 400.
- **Memory:** GC is requested through Chrome DevTools Protocol, and the hydrated page's `JSHeapUsedSize` is read before the click test. This is a single total heap snapshot per page; it does not isolate the cost of an instance or measure peak memory.

Time columns show the **median** of nine rounds and, in parentheses, minimum–maximum. You can reverse the order with `MEEKO_BENCH_ORDER=vue-first` to detect bias from always running the same engine first.

## Local results from October 23, 2026

Windows 11 `10.0.26300`, Intel Core Ultra 9 285K, Node 24.21.0, Chrome 155.0.8059.85, Vue 3.5.44, esbuild 0.28.2. Base revision `02096fc` with local uncommitted changes; order for this run: Vue → Meeko. It was repeated with the final compiler and state transfer. A second run reversed the order: both engines recorded a 5.00 ms median load, so that difference is inconclusive.

| Metric                  |                        Meeko |                          Vue |
| ----------------------- | ---------------------------: | ---------------------------: |
| Minified JS             |                      3.522 B |                     80.359 B |
| JS gzip                 |                      1.586 B |                     32.166 B |
| SSR per instance        | 0,00306 ms (0,00266–0,02375) | 0,01040 ms (0,00717–0,03290) |
| Local HTTP load         |          5,00 ms (4,30–5,30) |          5,00 ms (4,70–5,30) |
| Hydration               |          0,10 ms (0,00–0,10) |          0,20 ms (0,10–0,40) |
| Click and update        | 0,00250 ms (0,00250–0,00300) | 0,00275 ms (0,00250–0,00350) |
| JS heap after hydration |                  1.287.168 B |                  1.517.856 B |

In this counter, the size difference is clear. Loading and update measurements overlap, and hydration is near timer resolution: they do not establish a practical advantage. Heap is indicative because it is a single snapshot. Vue includes mature features Meeko does not yet offer, and a compiled Vue template could produce different figures from its `render` function. As the [Vue performance guide](https://vuejs.org/guide/best-practices/performance) explains, cost depends on each application's architecture and actual work.

## Extended scenarios: tree, list and navigation

```powershell
pnpm run benchmark:scenarios
$env:MEEKO_BENCH_ORDER = 'vue-first'
try { pnpm run benchmark:scenarios } finally { Remove-Item Env:MEEKO_BENCH_ORDER }
```

To isolate a workload, set `MEEKO_BENCH_SCENARIO` to `tree`, `list`, `navigation` or `navigation-mount`. The [scenario runner](../../packages/meeko/benchmarks/scenarios.ts) checks SSR HTML, node content and identity after each step, and the navigation URL. The [Vue](../../packages/meeko/benchmarks/vue-scenarios.ts) implementations use handwritten `render` functions and its production runtime, without a browser template compiler.

| Case              | Verified operation                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Tree              | 16 branches × 8 interactive leaves (145 components including the root). The first leaf is incremented and all 128 are checked.              |
| List              | 1,000 rows with stable keys. The last is rotated to the beginning; cardinality and keys are checked.                                        |
| Navigation, reuse | Three views of 40 rows. Each change preserves the same `section` and rows, and updates text, attribute and URL through `history.pushState`. |
| Navigation, mount | The same views and URL; each change replaces the `section` and its 40 rows in both engines.                                                 |

There are two warm-up rounds and seven measured rounds. SSR creates a new instance per render: 30 renders per round for tree and list, 100 for each navigation. The browser performs seven measured loads per case and engine with a warm cache; it measures `loadEventEnd - startTime`, hydration with `performance.now()` and a heap snapshot after requesting GC. Updates average 100 steps per round for tree, 30 for list and 60 for each navigation. This includes the click, reaction and Vue's `nextTick()`; the DOM check happens after the timer. Each engine's bundle includes all four cases and is measured once; it excludes HTML, CSS and HTTP headers.

### Local results from October 23, 2026

Windows 11 `10.0.26300`, Intel Core Ultra 9 285K, Node 24.21.0, Chrome 155.0.8059.85, Vue 3.5.44 and esbuild 0.28.2. Base revision `8bb0da1` with local uncommitted changes. Meeko → Vue was run, followed by Vue → Meeko, without other concurrent benchmarks. The table contains medians from the first run. Times are in milliseconds; update is per step. Heap is in MiB and is only a snapshot.

| Case              | Metric          |    Meeko |      Vue |
| ----------------- | --------------- | -------: | -------: |
| Tree              | SSR             |    0,505 |    1,058 |
| Tree              | Local HTTP load |      7,3 |      7,3 |
| Tree              | Hydration       |      1,3 |      1,3 |
| Tree              | Update          |    0,003 |    0,003 |
| Tree              | Heap JS         | 1,80 MiB | 1,89 MiB |
| List              | SSR             |    0,638 |    0,526 |
| List              | Local HTTP load |     14,1 |     11,7 |
| List              | Hydration       |      3,3 |      1,9 |
| List              | Update          |    0,263 |    0,437 |
| List              | Heap JS         | 3,17 MiB | 2,15 MiB |
| Navigation, reuse | SSR             |    0,040 |    0,015 |
| Navigation, reuse | Hydration       |      0,5 |      0,3 |
| Navigation, reuse | Update          |    0,055 |    0,067 |
| Navigation, mount | SSR             |    0,029 |    0,013 |
| Navigation, mount | Hydration       |      0,5 |      0,3 |
| Navigation, mount | Update          |    0,283 |    0,075 |

Combined bundle: Meeko 19,617 B (6,254 B gzip); Vue 83,084 B (32,958 B gzip). Reversing the order gave list updates of 0.260 versus 0.433 ms; navigation reusing nodes, 0.055 versus 0.065 ms; and full mounting, 0.283 versus 0.070 ms. The new list algorithm improves updates, but hydration and heap remain above Vue in this case. Fully mounting a view also remains slower. The previous navigation comparison mixed mounting in Meeko with reuse in Vue; it was replaced by the two equivalent workloads.

These figures belong to one machine and two specific implementations. Local HTTP loading does not measure real networks or Web Vitals; small update differences approach timer resolution. A production application and a Vue counterpart with a compiled template still need validation.

### Development memory optimization in 0.0.3

On the same machine and with the same runner, after skipping redundant initial DOM writes and allocating subscriber sets and index signals only when used, the suite was repeated in both orders. The 1,000-row list went from **3.17 MiB** in the previous record to **2.87 MiB** of JS heap after hydration (3,007,284 and 3,007,096 B); Vue recorded 2.15 MiB (2,255,532 and 2,259,476 B). Its update went from 0.263 ms to 0.223 and 0.217 ms per step; Vue recorded 0.433 and 0.437 ms.

List hydration recorded 3.9 and 3.1 ms in Meeko versus 1.8 and 1.9 ms in Vue. Variation between runs prevents attributing a precise change to this optimization, and cost remains above Vue. Full navigation mounting recorded 0.252 and 0.230 ms per step in Meeko versus 0.077 and 0.072 ms in Vue. Heap snapshots and local medians remain scenario indicators, not production guarantees.

## Consumer installed from npm

On October 23, 2026, `@meekojs/meeko@0.0.2` was installed twice from the public registry, each time in a temporary directory with an empty npm cache. A `.meeko` counter was compiled with the installed CLI, and seven separate Node processes importing the generated component and performing an SSR render were measured. Reproduce the test with `pwsh -NoProfile -File packages/meeko/benchmarks/measure-published-consumer.ps1 -Version 0.0.2`. Machine: Windows 11, Intel Core Ultra 9 285K, Node 24.21.0 and npm 11.19.0.

| Metric                            | First run |   Second run |
| --------------------------------- | --------: | -----------: |
| Installation with empty cache     |    7,98 s |       7,87 s |
| Files installed in `node_modules` |         — | 56.675.717 B |
| Files in `@meekojs/meeko`         |         — |    131.785 B |
| Counter compilation               |    745 ms |       721 ms |
| SSR process startup, median       |  65,42 ms |     65,26 ms |
| Component import, median          |  27,24 ms |     27,11 ms |
| First render, median              |  0,155 ms |     0,156 ms |

Installation includes downloading, resolving and extracting dependencies; its duration depends on the network and registry. Process time includes Node startup and module import. This is a single counter without an equivalent Vue counterpart or real deployment. The installed size, far larger than Meeko's own files, justifies evaluating a runtime/tooling split, but these data do not yet demonstrate that such a split improves a production consumer.
