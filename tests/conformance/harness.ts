import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rename, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prepareFrameworkTypes } from "../../src/framework/check-project.ts";
import { initFrameworkProject } from "../../src/framework/init.ts";
import { buildProject } from "../../src/framework/project.ts";

export type ConformanceAdapter = "node" | "bun" | "deno";

export interface RunningOutput {
  readonly origin: string;
  readonly output: string;
  logs(): string;
  stop(): Promise<void>;
}

const repository = resolve(".");
const fixture = resolve("tests/fixtures/conformance-app");

const runtimeVariables = { bun: "MEEKO_BUN", deno: "MEEKO_DENO" } as const;
const resolvedRuntimes = new Map<ConformanceAdapter, string | undefined>();

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
  const variable = runtimeVariables[adapter];
  const reason = `${adapter} runtime not found in ${variable}, PATH or \`mise where ${adapter}\`; install it or set ${variable} to run the ${adapter} conformance suite`;
  const required = (process.env.MEEKO_CONFORMANCE_REQUIRE ?? "").split(",").map((value) => value.trim());
  if (required.includes(adapter)) throw new Error(reason);
  return reason;
}

/** Version of the runtime that runs an adapter's output, for the test log. */
export function runtimeVersion(adapter: ConformanceAdapter): string {
  if (adapter === "node") return process.version;
  const command = runtimeCommand(adapter);
  return (command && versionOf(command)) ?? "missing";
}

/** Builds the fixture for an adapter and starts its output without the source tree. */
export async function startConformanceOutput(adapter: ConformanceAdapter): Promise<RunningOutput> {
  const projects = resolve(".meeko");
  await mkdir(projects, { recursive: true });
  const root = await mkdtemp(join(projects, `conformance-${adapter}-`));
  let child: ChildProcess | undefined;
  let logs = "";
  const stop = async (): Promise<void> => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  try {
    await initFrameworkProject(root);
    await cp(fixture, root, { recursive: true, filter: (source) => !source.endsWith("README.md") });
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(repository, join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await symlink(join(repository, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
    await prepareFrameworkTypes(root);
    const result = await buildProject(root, { adapter });
    // The output must not need the sources it was built from; Bun and Deno
    // bundles must not need node_modules either.
    const moved = join(root, "moved-sources");
    await mkdir(moved);
    const sources = ["app", "server", "shared", "public", "meeko.config.ts", ".meeko/generated", ".meeko/build"];
    if (adapter !== "node") sources.push("node_modules");
    for (const name of sources) await rename(join(root, name), join(moved, name.replaceAll("/", "-")));
    const entry = adapter === "node" ? "index.mjs" : adapter === "bun" ? "index.js" : "main.js";
    const args = adapter === "deno" ? ["run", "-A", join(result.output, entry)] : [join(result.output, entry)];
    child = spawn(runtimeCommand(adapter)!, args, {
      cwd: root, env: { ...process.env, PORT: "0", HOST: "127.0.0.1", NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const running = child;
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
    return { origin, output: result.output, logs: () => logs, stop };
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
}
