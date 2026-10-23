import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { build, version as esbuildVersion } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";
import { createSSRApp, version as vueVersion } from "vue";
import { renderToString as renderVueToString } from "vue/server-renderer";
import { VueCounter } from "./vue-counter.js";
import { renderToString as renderMeekoToString } from "../examples/counter/Counter.generated.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const warmupRounds = 2;
const measuredRounds = 9;
const ssrIterations = 500;
const updateIterations = 400;

type Framework = "meeko" | "vue";
type Samples = { median: number; minimum: number; maximum: number };

interface BrowserMeasurements {
  load: Samples;
  hydrate: Samples;
  update: Samples;
  heapBytes: number;
}

/** Resume muestras independientes con mediana y extremos, sin descartar valores. */
function summarize(samples: number[]): Samples {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)]!,
    minimum: sorted[0]!,
    maximum: sorted.at(-1)!,
  };
}

/** Mide el coste de crear una instancia y renderizarla en el servidor. */
async function measureSsr(render: () => string | Promise<string>): Promise<Samples> {
  if (!(await render()).replaceAll(/<!--[\s\S]*?-->/g, "").includes("0 · doble: 0")) {
    throw new Error("Incorrect SSR output");
  }
  const samples: number[] = [];
  for (let round = 0; round < warmupRounds + measuredRounds; round++) {
    const started = performance.now();
    for (let i = 0; i < ssrIterations; i++) {
      await render();
    }
    if (round >= warmupRounds) samples.push((performance.now() - started) / ssrIterations);
  }
  return summarize(samples);
}

/** Compila solamente el código de cliente entregado por cada ejemplo. */
async function buildClient(entry: Framework): Promise<Uint8Array> {
  const output = await build({
    entryPoints: [resolve(projectRoot, `benchmarks/${entry}-client.ts`)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    treeShaking: true,
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { meeko: resolve(projectRoot, "src/index.ts") },
  });
  const js = output.outputFiles[0];
  if (!js) throw new Error(`Missing ${entry} client bundle`);
  return js.contents;
}

/** Genera una página SSR mínima con idéntica estructura externa. */
function pageHtml(framework: Framework, ssrHtml: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${framework} benchmark</title><style>button { cursor: pointer; }</style></head><body><div id="app">${ssrHtml}</div><script type="module" src="/${framework}.js"></script></body></html>`;
}

/** Lee memoria de JS tras una recolección explícita del mismo contexto. */
async function usedHeap(page: Page): Promise<number> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Performance.enable");
    await session.send("HeapProfiler.collectGarbage");
    const { metrics } = await session.send("Performance.getMetrics");
    const heap = metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value;
    if (heap === undefined) throw new Error("Chrome did not report JSHeapUsedSize");
    return heap;
  } finally {
    await session.detach();
  }
}

/** Mide carga local, hidratación y un clic confirmado por iteración. */
async function measureBrowser(browser: Browser, url: string): Promise<BrowserMeasurements> {
  const page = await browser.newPage();
  const load: number[] = [];
  const hydrate: number[] = [];
  try {
    for (let round = 0; round < warmupRounds + measuredRounds; round++) {
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction(() => window.__meekoBenchmark !== undefined);
      const result = await page.evaluate(() => {
        const navigation = performance.getEntries().find((entry) => String(entry.entryType) === "navigation") as PerformanceNavigationTiming;
        if (!navigation) throw new Error("Missing browser navigation timing");
        return {
          loadMs: navigation.loadEventEnd - navigation.startTime,
          hydrationMs: window.__meekoBenchmark!.hydrationMs,
          text: document.querySelector("#app button")?.textContent,
        };
      });
      if (result.text !== "0 · doble: 0") throw new Error(`Incorrect browser SSR/hydration: ${result.text}`);
      if (round >= warmupRounds) {
        load.push(result.loadMs);
        hydrate.push(result.hydrationMs);
      }
    }
    const heapBytes = await usedHeap(page);
    const update: number[] = [];
    for (let round = 0; round < warmupRounds + measuredRounds; round++) {
      const elapsed = await page.evaluate(async (count) => {
        const started = performance.now();
        for (let i = 0; i < count; i++) await window.__meekoBenchmark!.step();
        return performance.now() - started;
      }, updateIterations);
      if (round >= warmupRounds) update.push(elapsed / updateIterations);
    }
    return { load: summarize(load), hydrate: summarize(hydrate), update: summarize(update), heapBytes };
  } finally {
    await page.close();
  }
}

/** Arranca un servidor HTTP local únicamente durante la medición. */
async function serve(pages: Record<Framework, string>, bundles: Record<Framework, Uint8Array>): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const route = request.url?.replace(/^\//, "") ?? "";
    if (route === "meeko" || route === "vue") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" });
      response.end(pages[route]);
    } else if (route === "meeko.js" || route === "vue.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600" });
      response.end(bundles[route.slice(0, -3) as Framework]);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing benchmark server port");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

/** Ejecuta y muestra cifras con versiones y configuración suficientes para repetirlas. */
async function main(): Promise<void> {
  const order: Framework[] = process.env.MEEKO_BENCH_ORDER === "vue-first" ? ["vue", "meeko"] : ["meeko", "vue"];
  const bundles: Record<Framework, Uint8Array> = {
    meeko: await buildClient("meeko"),
    vue: await buildClient("vue"),
  };
  const ssr = {} as Record<Framework, Samples>;
  for (const framework of order) {
    ssr[framework] = framework === "meeko"
      ? await measureSsr(() => renderMeekoToString({ initial: 0 }))
      : await measureSsr(() => renderVueToString(createSSRApp(VueCounter, { initial: 0 })));
  }
  const pages = {
    meeko: pageHtml("meeko", renderMeekoToString({ initial: 0 })),
    vue: pageHtml("vue", await renderVueToString(createSSRApp(VueCounter, { initial: 0 }))),
  };
  const { server, origin } = await serve(pages, bundles);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
      args: ["--enable-precise-memory-info"],
    });
    const browserResults = {} as Record<Framework, BrowserMeasurements>;
    for (const framework of order) browserResults[framework] = await measureBrowser(browser, `${origin}/${framework}`);
    const results = {
      environment: {
        node: process.version,
        vue: vueVersion,
        esbuild: esbuildVersion,
        chrome: browser.version(),
        revision: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim(),
        dirty: execFileSync("git", ["status", "--porcelain"], { cwd: projectRoot, encoding: "utf8" }).trim().length > 0,
        os: `${platform()} ${release()}`,
        cpu: cpus()[0]?.model ?? "unknown",
        rounds: measuredRounds,
        warmupRounds,
        ssrIterations,
        updateIterations,
        order,
      },
      meeko: {
        bundleBytes: bundles.meeko.byteLength,
        gzipBytes: gzipSync(bundles.meeko).byteLength,
        ssrMs: ssr.meeko,
        browser: browserResults.meeko,
      },
      vue: {
        bundleBytes: bundles.vue.byteLength,
        gzipBytes: gzipSync(bundles.vue).byteLength,
        ssrMs: ssr.vue,
        browser: browserResults.vue,
      },
    };
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

await main();
