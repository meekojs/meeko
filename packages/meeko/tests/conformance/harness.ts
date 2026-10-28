import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { prepareFrameworkTypes } from "../../src/framework/check-project.ts";
import { initFrameworkProject } from "../../src/framework/init.ts";
import { buildProject } from "../../src/framework/project.ts";

/** Windows antivirus or indexing can briefly hold a just-written file open. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { return await rename(from, to); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 10 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

/** `workerd` builds with the cloudflare adapter and runs under `wrangler dev`'s runtime. */
export type ConformanceAdapter = "node" | "bun" | "deno" | "workerd";

/** Workers-only controls of the local runtime. */
export interface WorkerdControls {
  /** Evicts a Socket room Durable Object; its WebSockets stay open and hibernate. */
  hibernate(channel: string, room: string): Promise<void>;
  /** Reads rows from the local D1 database bound as DB. */
  query(sql: string): Promise<Array<Record<string, unknown>>>;
}

export interface RunningOutput {
  readonly origin: string;
  readonly output: string;
  readonly workerd?: WorkerdControls;
  /** Exit code of the output's process (Node, Bun and Deno); `undefined` on workerd. */
  readonly exited?: Promise<number | null>;
  logs(): string;
  stop(): Promise<void>;
}

const repository = resolve(".");
const fixture = resolve("tests/fixtures/conformance-app");

const runtimeVariables = { bun: "MEEKO_BUN", deno: "MEEKO_DENO" } as const;
const resolvedRuntimes = new Map<ConformanceAdapter, string | undefined>();
const requireFromRepository = createRequire(join(repository, "package.json"));

/** Wrangler's package.json, or undefined when the devDependency is not installed. */
function wranglerManifest(): string | undefined {
  try { return requireFromRepository.resolve("wrangler/package.json"); }
  catch { return undefined; }
}

function versionOf(command: string): string | undefined {
  const probe = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true });
  return probe.status === 0 ? probe.stdout.trim().split(/\r?\n/)[0] : undefined;
}

/**
 * Finds the executable that runs an adapter's build output: MEEKO_BUN or
 * MEEKO_DENO first, then PATH, then a version installed with `mise` that is
 * not active in this directory (`mise where <tool>`).
 */
function runtimeCommand(adapter: ConformanceAdapter): string | undefined {
  if (adapter === "node") return process.execPath;
  if (adapter === "workerd") return wranglerManifest();
  if (resolvedRuntimes.has(adapter)) return resolvedRuntimes.get(adapter);
  const configured = process.env[runtimeVariables[adapter]];
  let command: string | undefined;
  if (configured) command = versionOf(configured) ? configured : undefined;
  else if (versionOf(adapter)) command = adapter;
  else {
    const where = spawnSync("mise", ["where", adapter], { encoding: "utf8", windowsHide: true });
    const installed = where.status === 0 ? where.stdout.trim() : "";
    const candidate = installed ? join(installed, "bin", process.platform === "win32" ? `${adapter}.exe` : adapter) : "";
    if (candidate && versionOf(candidate)) command = candidate;
  }
  resolvedRuntimes.set(adapter, command);
  return command;
}

/**
 * Returns why an adapter's runtime cannot run, or undefined when it can. A
 * runtime listed in MEEKO_CONFORMANCE_REQUIRE (comma separated) must exist.
 */
export function missingRuntime(adapter: ConformanceAdapter): string | undefined {
  if (adapter === "node" || runtimeCommand(adapter)) return undefined;
  const reason = adapter === "workerd"
    ? "wrangler is not installed; run pnpm install to run the workerd conformance suite"
    : `${adapter} runtime not found in ${runtimeVariables[adapter]}, PATH or \`mise where ${adapter}\`; install it or set ${runtimeVariables[adapter]} to run the ${adapter} conformance suite`;
  const required = (process.env.MEEKO_CONFORMANCE_REQUIRE ?? "").split(",").map((value) => value.trim());
  if (required.includes(adapter)) throw new Error(reason);
  return reason;
}

/** Version of the runtime that runs an adapter's output, for the test log. */
export function runtimeVersion(adapter: ConformanceAdapter): string {
  if (adapter === "node") return process.version;
  if (adapter === "workerd") {
    const manifest = wranglerManifest();
    if (!manifest) return "missing";
    const version = (file: string) => (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
    const miniflare = createRequire(manifest).resolve("miniflare/package.json");
    const workerd = createRequire(miniflare).resolve("workerd/package.json");
    return `workerd ${version(workerd)} (wrangler ${version(manifest)})`;
  }
  const command = runtimeCommand(adapter);
  return (command && versionOf(command)) ?? "missing";
}

/** Bindings the workerd variant adds to the generated wrangler.jsonc. */
const workerdConfig = `import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "cloudflare",
    name: "meeko-conformance",
    wrangler: { d1_databases: [{ binding: "DB", database_name: "meeko-conformance", database_id: "00000000-0000-4000-8000-000000000000" }] },
  },
});
`;

interface WranglerTestHarness {
  listen(): Promise<{ url: URL }>;
  getWorker(): {
    getEnv(): Promise<Record<string, unknown>>;
    evictDurableObject(className: string, options: { name: string; webSockets: "hibernate" }): Promise<void>;
  };
  getLogs(): Array<{ level: string; message: string }>;
  close(): Promise<void>;
}

interface D1Database {
  prepare(query: string): { run(): Promise<unknown>; all(): Promise<{ results: Array<Record<string, unknown>> }> };
}

/**
 * Runs the Cloudflare output the way `wrangler dev` does (workerd behind
 * Wrangler's local proxy) from the generated wrangler.jsonc, with in-memory
 * D1 and Durable Object storage, and applies the D1 session schema.
 */
async function startWorkerd(output: string): Promise<{ origin: string; workerd: WorkerdControls; logs(): string; stop(): Promise<void> }> {
  const { createTestHarness } = await import("wrangler") as unknown as { createTestHarness(options: unknown): WranglerTestHarness };
  const { D1SessionDriver } = await import("../../src/cloudflare.ts");
  const harness = createTestHarness({ root: output, workers: [{ configPath: join(output, "wrangler.jsonc") }] });
  const logs = () => harness.getLogs().map((log) => `[${log.level}] ${log.message}`).join("\n");
  try {
    const { url } = await harness.listen();
    const worker = harness.getWorker();
    const db = (await worker.getEnv()).DB as D1Database;
    for (const statement of D1SessionDriver.schema().split(";").map((part) => part.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
    const workerd: WorkerdControls = {
      hibernate: (channel, room) => worker.evictDurableObject("MeekoSocketRoom", { name: `${channel}\0${room}`, webSockets: "hibernate" }),
      query: async (sql) => (await db.prepare(sql).all()).results,
    };
    return { origin: url.origin, workerd, logs, stop: () => harness.close() };
  } catch (error) {
    await harness.close().catch(() => {});
    throw new Error(`workerd output did not start: ${error instanceof Error ? error.message : String(error)}\n${logs()}`, { cause: error });
  }
}

/** Builds the fixture for an adapter and starts its output without the source tree. */
export async function startConformanceOutput(adapter: ConformanceAdapter): Promise<RunningOutput> {
  const projects = resolve(".meeko");
  await mkdir(projects, { recursive: true });
  const root = await mkdtemp(join(projects, `conformance-${adapter}-`));
  let child: ChildProcess | undefined;
  let workerd: Awaited<ReturnType<typeof startWorkerd>> | undefined;
  let logs = "";
  const stop = async (): Promise<void> => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await workerd?.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  try {
    await initFrameworkProject(root);
    await cp(fixture, root, { recursive: true, filter: (source) => !source.endsWith("README.md") });
    if (adapter === "workerd") await writeFile(join(root, "meeko.config.ts"), workerdConfig, "utf8");
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(repository, join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await symlink(join(repository, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
    await prepareFrameworkTypes(root);
    const result = await buildProject(root, { adapter: adapter === "workerd" ? "cloudflare" : adapter });
    // The output must not need the sources it was built from; Bun, Deno and
    // Workers bundles must not need node_modules either.
    const moved = join(root, "moved-sources");
    await mkdir(moved);
    const sources = ["app", "server", "shared", "public", "meeko.config.ts", ".meeko/generated", ".meeko/build"];
    if (adapter !== "node") sources.push("node_modules");
    for (const name of sources) await renameWithRetry(join(root, name), join(moved, name.replaceAll("/", "-")));
    if (adapter === "workerd") {
      workerd = await startWorkerd(result.output);
      const running = workerd;
      return { origin: running.origin, output: result.output, workerd: running.workerd, logs: running.logs, stop };
    }
    const entry = adapter === "node" ? "index.mjs" : adapter === "bun" ? "index.js" : "main.js";
    const args = adapter === "deno" ? ["run", "-A", join(result.output, entry)] : [join(result.output, entry)];
    child = spawn(runtimeCommand(adapter)!, args, {
      cwd: root, env: { ...process.env, PORT: "0", MEEKO_HOST: "127.0.0.1", NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const running = child;
    const exited = new Promise<number | null>((done) => running.once("exit", (code) => done(code)));
    running.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    running.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    const origin = await new Promise<string>((done, fail) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const url = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        if (url) { clearInterval(timer); done(url); }
        else if (running.exitCode !== null) { clearInterval(timer); fail(new Error(`${adapter} output exited: ${logs}`)); }
        else if (Date.now() - start > 30_000) { clearInterval(timer); fail(new Error(`${adapter} output did not listen: ${logs}`)); }
      }, 25);
    });
    return { origin, output: result.output, exited, logs: () => logs, stop };
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
}
