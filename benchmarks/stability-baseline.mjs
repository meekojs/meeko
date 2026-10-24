import { Worker } from "node:worker_threads";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumer = resolve(process.env.MEEKO_BENCH_CONSUMER ?? join(root, ".meeko", "fullstack-consumer"));
const output = resolve(process.env.MEEKO_BENCH_OUTPUT ?? join(root, ".meeko", "benchmarks", "stability-baseline.json"));
const origin = `http://127.0.0.1:${process.env.MEEKO_TEST_PORT ?? "4387"}`;
const rounds = 7;
const warmups = 2;

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const value = (p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  return { samples: sorted.length, median: value(0.5), p10: value(0.1), p90: value(0.9), minimum: sorted[0], maximum: sorted.at(-1) };
}

async function repeated(run, iterations = 1) {
  const values = [];
  for (let round = 0; round < warmups + rounds; round++) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) await run();
    if (round >= warmups) values.push((performance.now() - start) / iterations);
  }
  return summary(values);
}

function compileInFreshWorker(source, file) {
  const compiler = pathToFileURL(join(root, "dist", "compiler.js")).href;
  const code = `const { parentPort, workerData } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
(async () => { const { compile } = await import(workerData.compiler); const start = performance.now(); compile(workerData.source, workerData.file); parentPort.postMessage(performance.now() - start); })().catch(error => { throw error; });`;
  return new Promise((done, reject) => {
    const worker = new Worker(code, { eval: true, workerData: { compiler, source, file } });
    worker.once("message", done);
    worker.once("error", reject);
    worker.once("exit", (exitCode) => { if (exitCode !== 0) reject(new Error(`Compiler worker exited ${exitCode}`)); });
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No free port");
  await new Promise((done) => server.close(done));
  return address.port;
}

async function waitReady(url, process) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (process.exitCode !== null) throw new Error(`Development server exited ${process.exitCode}`);
    try { if ((await fetch(url)).status === 200) return; } catch { /* Startup pending. */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Development server did not become ready");
}

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(file));
    else if (entry.isFile() && [".js", ".css"].includes(extname(file))) result.push(file);
  }
  return result;
}

async function bundleSize(directory) {
  const assets = await files(directory);
  let bytes = 0;
  let gzipBytes = 0;
  for (const file of assets) {
    const content = await readFile(file);
    bytes += content.byteLength;
    gzipBytes += gzipSync(content).byteLength;
  }
  return { files: assets.length, bytes, gzipBytes };
}

async function main() {
  if (!(await stat(join(consumer, ".meeko", "output", "server", "entry.js")).catch(() => undefined))) {
    throw new Error("Build the external full-stack consumer before benchmarking");
  }
  const sourceFile = join(consumer, "app", "pages", "users", "index.meeko");
  const source = await readFile(sourceFile, "utf8");
  const cold = [];
  for (let i = 0; i < rounds; i++) cold.push(await compileInFreshWorker(source, sourceFile));
  const { compile } = await import(pathToFileURL(join(root, "dist", "compiler.js")).href);
  let edit = 0;
  const warmCompile = await repeated(() => {
    compile(source.replace("Users</h1>", `Users ${edit++}</h1>`), sourceFile);
  });

  const engineBuild = await build({ entryPoints: [join(root, "src", "index.ts")], bundle: true, write: false, minify: true, format: "esm", platform: "browser", target: "es2022" });
  const engineBundle = engineBuild.outputFiles[0]?.contents;
  if (!engineBundle) throw new Error("Engine bundle was not generated");
  const engineSize = { bytes: engineBundle.byteLength, gzipBytes: gzipSync(engineBundle).byteLength };
  const minimalSize = await bundleSize(join(root, "examples", "vite", "dist", "assets"));
  const fullstackSize = await bundleSize(join(consumer, ".meeko", "output", "client", "assets"));

  const oldCwd = process.cwd();
  process.chdir(consumer);
  let runtime;
  try {
    const serverApi = await import(pathToFileURL(join(consumer, "node_modules", "@meekojs", "meeko", "dist", "node.js")).href);
    const entry = await import(pathToFileURL(join(consumer, ".meeko", "output", "server", "entry.js")).href);
    const routes = await serverApi.discoverConfiguredRoutes(consumer);
    runtime = await entry.createAppRuntime(consumer, routes, "/app/entry-client.ts", true);
    const request = () => new Request(`${origin}/`);
    const render = async () => { const response = await runtime.pageHandler(request()); if (response.status !== 200) throw new Error(`SSR ${response.status}`); await response.text(); };
    const ssrMs = await repeated(render, 100);
    globalThis.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    let peakRss = process.memoryUsage().rss;
    for (let i = 0; i < 500; i++) { await render(); if (i % 25 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss); }
    globalThis.gc?.();
    const heapAfter = process.memoryUsage().heapUsed;
    const memory = { heapBeforeBytes: heapBefore, heapAfterBytes: heapAfter, heapDeltaBytes: heapAfter - heapBefore, peakRssBytes: peakRss, requests: 500 };
    const apiMs = await repeated(async () => {
      const response = await runtime.endpointHandler(new Request(`${origin}/api/users`));
      if (response.status !== 200) throw new Error(`API ${response.status}`);
      await response.text();
    }, 100);
    const login = await runtime.endpointHandler(new Request(`${origin}/api/auth/login`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ user: "benchmark" }),
    }));
    if (login.status !== 200) throw new Error(`Benchmark login ${login.status}`);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    const token = (await login.json()).csrfToken;
    const rpcMs = await repeated(async () => {
      const response = await runtime.endpointHandler(new Request(`${origin}/_meeko/rpc/users/get`, {
        method: "POST", headers: { origin, cookie, "x-meeko-csrf": token, "content-type": "application/json" }, body: JSON.stringify({ id: "benchmark" }),
      }));
      if (response.status !== 200) throw new Error(`RPC ${response.status}`);
      await response.text();
    }, 100);

    const browserChannel = process.env.MEEKO_BROWSER_CHANNEL ?? "chrome";
    const browser = await chromium.launch({ channel: browserChannel, headless: true });
    let hydrationMs;
    let navigationMs;
    let hmrMs;
    try {
      const page = await browser.newPage();
      const hydration = [];
      for (let i = 0; i < warmups + rounds; i++) {
        await page.goto(`${origin}/`, { waitUntil: "load" });
        await page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);
        const duration = await page.evaluate(() => performance.getEntriesByName("meeko-hydration")[0].duration);
        if (i >= warmups) hydration.push(duration);
      }
      hydrationMs = summary(hydration);
      const navigation = [];
      for (let i = 0; i < warmups + rounds; i++) {
        const pathname = i % 2 === 0 ? "/users" : "/";
        const elapsed = await page.evaluate(async (path) => {
          const start = performance.now();
          await window.__meekoTestApp.navigate(path);
          return performance.now() - start;
        }, pathname);
        if (i >= warmups) navigation.push(elapsed);
      }
      navigationMs = summary(navigation);
      await page.close();

      const indexFile = join(root, "examples", "vite", "Hot.meeko");
      const original = await readFile(indexFile, "utf8");
      const hmr = [];
      for (let i = 0; i < warmups + rounds; i++) {
        const devPort = await freePort();
        const dev = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "examples/vite", "--config", "examples/vite/vite.config.ts", "--host", "127.0.0.1", "--port", String(devPort), "--strictPort"], {
          cwd: root, env: process.env, stdio: "ignore", windowsHide: true,
        });
        try {
          await waitReady(`http://127.0.0.1:${devPort}/`, dev);
          const devPage = await browser.newPage();
          const hmrErrors = [];
          devPage.on("console", (message) => { if (message.type() === "error") hmrErrors.push(message.text()); });
          devPage.on("pageerror", (error) => hmrErrors.push(error.message));
          await devPage.goto(`http://127.0.0.1:${devPort}/`);
          await devPage.locator("#hot button").waitFor();
          const marker = `HMR sample ${i}`;
          const start = performance.now();
          await writeFile(indexFile, original.replace("Hot v3", marker));
          try { await devPage.waitForFunction((value) => document.body.textContent?.includes(value), marker, { timeout: 10_000 }); }
          catch (error) { throw new Error(`HMR marker ${marker} missing; hot=${await devPage.locator("#hot").innerText()}; errors=${hmrErrors.join(" | ")}`, { cause: error }); }
          if (i >= warmups) hmr.push(performance.now() - start);
          await devPage.close();
        } finally {
          await writeFile(indexFile, original);
          dev.kill("SIGINT");
          await new Promise((done) => { if (dev.exitCode !== null) done(); else dev.once("exit", done); });
        }
      }
      hmrMs = summary(hmr);
    } finally { await browser.close(); }

    const report = {
      environment: {
        timestamp: new Date().toISOString(), node: process.version, os: `${platform()} ${release()}`,
        cpu: cpus()[0]?.model ?? "unknown", chrome: `channel:${browserChannel}`, rounds, warmups,
        consumer: "tarball-installed full-stack fixture", productionOrigin: origin,
      },
      metrics: {
        compileColdMs: summary(cold), compileAfterEditMs: warmCompile, hmrBrowserUpdateMs: hmrMs,
        ssrRequestMs: ssrMs, hydrationMs, clientNavigationMs: navigationMs,
        engineBundle: engineSize, minimalAppBundle: minimalSize, fullstackAppBundle: fullstackSize,
        ssrMemory: memory, apiDispatchMs: apiMs, rpcDispatchMs: rpcMs,
      },
      notes: [
        "Cold compilation times exclude worker startup and module import; each sample uses a fresh worker.",
        "Compile-after-edit measures full compile of a changed source; Meeko does not cache compiler output.",
        "HMR measures file write through visible browser update in the official Vite example's development mode.",
        "SSR and dispatcher timings use in-process Fetch handlers from the production server bundle.",
        "Hydration duration uses marks around mountClientApp in the external fixture.",
        "Client navigation uses mountClientApp.navigate with serverData enabled.",
        "Minimal app size is the existing examples/vite production asset set; full-stack size is the tarball-installed fixture asset set.",
      ],
    };
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log(`Benchmark baseline: ${output}`);
    console.log(JSON.stringify(report.metrics));
  } finally {
    await runtime?.sessions.close();
    process.chdir(oldCwd);
  }
}

await main();
