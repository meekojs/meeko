import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { testTempRoot } from "../../scripts/test-tmp-root.mjs";

/** The repository root, independent of the working directory of the test run. */
export const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * Parent of every temporary test project: a directory of this checkout in the system's
 * temporary directory (see `scripts/test-tmp-root.mjs`). Outside the repository no editor
 * or watcher of a workspace sees the projects, and their `meeko dev` bridges, contracts and
 * generated files stay theirs. Its `node_modules` links to the repository's, so projects
 * resolve the repository's dependencies as they would inside it; `@meekojs/meeko` itself is
 * linked by each project with {@link linkRepositoryPackages}. `scripts/clean-test-tmp.mjs`
 * empties it before each test run, so an interrupted run leaves nothing behind.
 */
export const tempProjectsRoot = testTempRoot(repositoryRoot);

/**
 * Creates {@link tempProjectsRoot}, its link to the repository's `node_modules` and a
 * `package.json` with `"type": "module"`: inside the repository the projects inherited the
 * repository's, and without it Node would load their compiled `.ts` files as CommonJS, with a
 * second copy of the runtime. A project that writes its own `package.json` overrides it.
 */
async function prepareTempProjectsRoot(): Promise<void> {
  await mkdir(tempProjectsRoot, { recursive: true });
  await writeFile(join(tempProjectsRoot, "package.json"), `${JSON.stringify({ private: true, type: "module" })}\n`);
  try {
    await symlink(join(repositoryRoot, "node_modules"), join(tempProjectsRoot, "node_modules"), "junction");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

/**
 * Links packages of the repository into `<root>/node_modules`, as an install would:
 * `@meekojs/meeko` is the repository itself (its `exports` point to `dist/`); any other
 * name is the repository's own dependency, e.g. `vite` or `@types`.
 */
export async function linkRepositoryPackages(root: string, names: readonly string[] = ["@meekojs/meeko"]): Promise<void> {
  for (const name of names) {
    const link = join(root, "node_modules", ...name.split("/"));
    await mkdir(dirname(link), { recursive: true });
    await symlink(name === "@meekojs/meeko" ? repositoryRoot : join(repositoryRoot, "node_modules", ...name.split("/")), link, "junction");
  }
}

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

/** Creates `<tempProjectsRoot>/<prefix>-<random>`; the caller removes it in `finally` or an `after` hook. */
export async function createTempProject(prefix: string): Promise<TempProject> {
  if (!/^[\w.-]+$/.test(prefix)) throw new Error(`Invalid temporary project prefix: ${prefix}`);
  await prepareTempProjectsRoot();
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
