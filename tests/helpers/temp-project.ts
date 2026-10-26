import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, independent of the working directory of the test run. */
export const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * Parent of every temporary test project inside the repository. Projects live
 * here when they must resolve the repository's packages; `scripts/clean-test-tmp.mjs`
 * empties it before each test run, so an interrupted run leaves nothing behind.
 */
export const tempProjectsRoot = join(repositoryRoot, ".meeko", "tmp");

/** A temporary project directory and the function that deletes it. */
export interface TempProject {
  readonly root: string;
  /** Deletes the project; retries while Windows still holds its files. Idempotent. */
  remove(): Promise<void>;
}

/** Deletes a directory under {@link tempProjectsRoot}; refuses any other path. */
export async function removeTempProject(directory: string): Promise<void> {
  const path = relative(tempProjectsRoot, resolve(directory));
  if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`Refusing to remove ${directory}: it is not a temporary test project`);
  }
  // A dev server or browser that just exited can keep handles open for a moment on Windows.
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/** Creates `.meeko/tmp/<prefix>-<random>`; the caller removes it in `finally` or an `after` hook. */
export async function createTempProject(prefix: string): Promise<TempProject> {
  if (!/^[\w.-]+$/.test(prefix)) throw new Error(`Invalid temporary project prefix: ${prefix}`);
  await mkdir(tempProjectsRoot, { recursive: true });
  const root = await mkdtemp(join(tempProjectsRoot, `${prefix.replace(/-$/, "")}-`));
  return { root, remove: () => removeTempProject(root) };
}

/** Stops a process started on a temporary project and waits for it to exit, so its files can be removed. */
export async function stopChild(child: ChildProcess | undefined, signal: NodeJS.Signals = "SIGINT"): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill(signal);
  await exited;
}

/**
 * Creates a temporary project and removes it after the test, even when the
 * test fails or times out. `cleanup` runs first, to stop what uses the project.
 */
export async function tempProject(
  context: { after(fn: () => Promise<void>): void },
  prefix: string,
  cleanup?: () => unknown,
): Promise<string> {
  const project = await createTempProject(prefix);
  context.after(async () => {
    try { await cleanup?.(); } finally { await project.remove(); }
  });
  return project.root;
}
