import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build, version as esbuildVersion } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";
import { createSSRApp, version as vueVersion } from "vue";
import { renderToString as renderVueToString } from "vue/server-renderer";
import { renderToString as renderMeekoTree } from "./cases/Tree.generated.ts";
import { renderToString as renderMeekoList } from "./cases/List.generated.ts";
import { renderToString as renderMeekoNavigation } from "./cases/Navigation.generated.ts";
import { VueTree, VueList, VueNavigation } from "./vue-scenarios.js";
import type { Scenario } from "./scenario-protocol.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const warmupRounds = 2;
const measuredRounds = 7;
const scenarios: Scenario[] = ["tree", "list", "navigation"];

type Framework = "meeko" | "vue";
type Samples = { median: number; minimum: number; maximum: number };
type CaseConfig = { ssrIterations: number; updateIterations: number };

const config: Record<Scenario, CaseConfig> = {
  tree: { ssrIterations: 30, updateIterations: 100 },
  list: { ssrIterations: 30, updateIterations: 30 },
  navigation: { ssrIterations: 100, updateIterations: 60 },
};

/** Resume las siete rondas medidas, sin eliminar valores extremos. */
function summarize(samples: number[]): Samples {
  const sorted = [...samples].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)]!, minimum: sorted[0]!, maximum: sorted.at(-1)! };
}

/** Crea una instancia nueva en cada render SSR. */
function renderMeeko(scenario: Scenario): string {
  if (scenario === "tree") return renderMeekoTree({});
  if (scenario === "list") return renderMeekoList({});
  return renderMeekoNavigation({});
}

/** Crea una aplicación Vue nueva en cada render SSR. */
async function renderVue(scenario: Scenario): Promise<string> {
  const component = scenario === "tree" ? VueTree : scenario === "list" ? VueList : VueNavigation;
  return renderVueToString(createSSRApp(component));
}

/** Comprueba forma y cardinalidad del HTML, además de las comprobaciones del navegador. */
function assertServerHtml(html: string, scenario: Scenario): void {
  const count = (needle: RegExp): number => [...html.matchAll(needle)].length;
  if (scenario === "tree" && count(/data-id="\d+-\d+"/g) !== 128) throw new Error("Incorrect tree SSR");
  if (scenario === "list" && count(/<li\b/g) !== 1000) throw new Error("Incorrect list SSR");
  if (scenario === "navigation" && (!html.includes("View 0") || count(/<p\b/g) !== 40)) {
    throw new Error("Incorrect navigation SSR");
  }
}

/** Incluye la creación de la instancia y el await en ambos motores. */
async function measureSsr(render: () => string | Promise<string>, scenario: Scenario): Promise<Samples> {
  assertServerHtml(await render(), scenario);
  const samples: number[] = [];
  for (let round = 0; round < warmupRounds + measuredRounds; round++) {
    const started = performance.now();
    for (let i = 0; i < config[scenario].ssrIterations; i++) await render();
    if (round >= warmupRounds) samples.push((performance.now() - started) / config[scenario].ssrIterations);
  }
  return summarize(samples);
}

/** Cada motor empaqueta sus tres casos; el tamaño mide este conjunto, no un caso individual. */
async function buildClient(framework: Framework): Promise<Uint8Array> {
  const output = await build({
    entryPoints: [resolve(projectRoot, `benchmarks/${framework}-scenarios-client.ts`)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    treeShaking: true,
    define: { "process.env.NODE_ENV": '"production"' },
    alias: {
      "@meekojs/meeko/internal": resolve(projectRoot, "src/internal.ts"),
      "@meekojs/meeko": resolve(projectRoot, "src/index.ts"),
    },
  });
  const file = output.outputFiles[0];
  if (!file) throw new Error(`Missing ${framework} bundle`);
  return file.contents;
}

/** Sirve HTML SSR y bundles idénticamente para los dos motores. */
async function serve(
  pages: Record<Framework, Record<Scenario, string>>,
  bundles: Record<Framework, Uint8Array>,
): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const framework = url.pathname.slice(1);
    const scenario = url.searchParams.get("scenario");
    if ((framework === "meeko" || framework === "vue") && (scenario === "tree" || scenario === "list" || scenario === "navigation")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" });
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${framework} ${scenario}</title></head><body><div id="app">${pages[framework][scenario]}</div><script type="module" src="/${framework}.js"></script></body></html>`);
    } else if (framework === "meeko.js" || framework === "vue.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600" });
      response.end(bundles[framework.slice(0, -3) as Framework]);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing benchmark port");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

/** Una instantánea de heap después de hidratar y solicitar GC. */
async function usedHeap(page: Page): Promise<number> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Performance.enable");
    await session.send("HeapProfiler.collectGarbage");
    const { metrics } = await session.send("Performance.getMetrics");
    const heap = metrics.find((item) => item.name === "JSHeapUsedSize")?.value;
    if (heap === undefined) throw new Error("Missing JSHeapUsedSize metric");
    return heap;
  } finally {
    await session.detach();
  }
}

/** Mide navegaciones calientes, hidratación, memoria y actualización validada. */
async function measureBrowser(browser: Browser, url: string, scenario: Scenario): Promise<{
  load: Samples; hydrate: Samples; update: Samples; heapBytes: number;
}> {
  const page = await browser.newPage();
  const load: number[] = [];
  const hydrate: number[] = [];
  try {
    for (let round = 0; round < warmupRounds + measuredRounds; round++) {
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction(() => window.__meekoScenario !== undefined);
      const measure = await page.evaluate(() => {
        window.__meekoScenario!.verify();
        const navigation = performance.getEntries().find((entry) => String(entry.entryType) === "navigation") as PerformanceNavigationTiming | undefined;
        if (!navigation) throw new Error("Missing Navigation Timing");
        return { loadMs: navigation.loadEventEnd - navigation.startTime, hydrateMs: window.__meekoScenario!.hydrationMs };
      });
      if (round >= warmupRounds) {
        load.push(measure.loadMs);
        hydrate.push(measure.hydrateMs);
      }
    }
    const heapBytes = await usedHeap(page);
    const update: number[] = [];
    for (let round = 0; round < warmupRounds + measuredRounds; round++) {
      const elapsed = await page.evaluate(async (count) => {
        let elapsed = 0;
        for (let i = 0; i < count; i++) {
          const started = performance.now();
          await window.__meekoScenario!.step();
          elapsed += performance.now() - started;
          window.__meekoScenario!.verify();
        }
        return elapsed;
      }, config[scenario].updateIterations);
      if (round >= warmupRounds) update.push(elapsed / config[scenario].updateIterations);
    }
    return { load: summarize(load), hydrate: summarize(hydrate), update: summarize(update), heapBytes };
  } finally {
    await page.close();
  }
}

/** Ejecuta los escenarios seleccionados y produce JSON con entorno y configuración. */
async function main(): Promise<void> {
  const selected = process.env.MEEKO_BENCH_SCENARIO;
  if (selected && selected !== "tree" && selected !== "list" && selected !== "navigation") {
    throw new Error(`Invalid MEEKO_BENCH_SCENARIO: ${selected}`);
  }
  const cases = selected ? [selected] as Scenario[] : scenarios;
  const order: Framework[] = process.env.MEEKO_BENCH_ORDER === "vue-first" ? ["vue", "meeko"] : ["meeko", "vue"];
  const bundles = { meeko: await buildClient("meeko"), vue: await buildClient("vue") };
  const pages = { meeko: {} as Record<Scenario, string>, vue: {} as Record<Scenario, string> };
  const ssr = {} as Record<Scenario, Record<Framework, Samples>>;
  for (const scenario of cases) {
    pages.meeko[scenario] = renderMeeko(scenario);
    pages.vue[scenario] = await renderVue(scenario);
    assertServerHtml(pages.meeko[scenario], scenario);
    assertServerHtml(pages.vue[scenario], scenario);
    ssr[scenario] = {} as Record<Framework, Samples>;
    for (const framework of order) {
      ssr[scenario][framework] = await measureSsr(
        framework === "meeko" ? () => renderMeeko(scenario) : () => renderVue(scenario), scenario,
      );
    }
  }
  const { server, origin } = await serve(pages, bundles);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
      args: ["--enable-precise-memory-info"],
    });
    const results = {} as Record<Scenario, Record<Framework, unknown>>;
    for (const scenario of cases) {
      results[scenario] = {} as Record<Framework, unknown>;
      for (const framework of order) {
        results[scenario][framework] = {
          ssrMs: ssr[scenario][framework],
          browser: await measureBrowser(browser, `${origin}/${framework}?scenario=${scenario}`, scenario),
        };
      }
    }
    console.log(JSON.stringify({
      environment: {
        node: process.version,
        vue: vueVersion,
        esbuild: esbuildVersion,
        chrome: browser.version(),
        revision: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim(),
        dirty: execFileSync("git", ["status", "--porcelain"], { cwd: projectRoot, encoding: "utf8" }).trim().length > 0,
        os: `${platform()} ${release()}`,
        cpu: cpus()[0]?.model ?? "unknown",
        order,
        warmupRounds,
        measuredRounds,
        config,
        bundle: {
          meeko: { bytes: bundles.meeko.byteLength, gzipBytes: gzipSync(bundles.meeko).byteLength },
          vue: { bytes: bundles.vue.byteLength, gzipBytes: gzipSync(bundles.vue).byteLength },
        },
      },
      scenarios: results,
    }, null, 2));
  } finally {
    await browser?.close();
    await new Promise<void>((done) => server.close(() => done()));
  }
}

await main();
