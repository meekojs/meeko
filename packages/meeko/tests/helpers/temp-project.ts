import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { testTempRoot } from "../../scripts/test-tmp-root.mjs";

/** The repository root, independent of the working directory of the test run. */
export const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * Parent of every temporary test project: a directory of this checkout in the system's
 * temporary directory (see `scripts/test-tmp-root.mjs`). Outside the repository no editor
 * or watcher of a workspace sees the projects, and their `meeko dev` bridges, contracts and
 * generated files stay theirs. Its `node_modules` mirrors the repository's (see
 * {@link linkRepositoryDependencies}), so projects resolve the repository's dependencies as
 * they would inside it; `@meekojs/meeko` itself is linked by each project with
 * {@link linkRepositoryPackages}. `scripts/clean-test-tmp.mjs` empties it before each test
 * run, so an interrupted run leaves nothing behind.
 */
export const tempProjectsRoot = testTempRoot(repositoryRoot);

/** Links `link` to the directory `target`; a link left by an earlier run to another directory is replaced. */
async function linkDirectory(target: string, link: string): Promise<void> {
  try {
    await symlink(target, link, "junction");
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (await realpath(link).catch(() => undefined) === target) return;
  // An install moved the package since: `unlink` removes only a link, never a directory.
  await unlink(link);
  await symlink(target, link, "junction");
}

/**
 * Mirrors the repository's `node_modules` in `directory`: one junction (a directory symlink
 * outside Windows) per dependency, to the real directory of the package. pnpm links each
 * dependency with a relative symlink where Windows lets it create one, as on an elevated CI
 * runner, and with a junction where it does not. Windows does not resolve such a relative
 * symlink reached through a link to the `node_modules` that holds it, so Node and TypeScript 7
 * missed `@typescript/typescript6` and `@types/node` there: the folder is mirrored, not linked.
 * Entries that start with a dot (`.bin`, tool caches) are left out. Returns the links, so the
 * caller can remove them before deleting `directory`.
 */
export async function linkRepositoryDependencies(directory: string): Promise<string[]> {
  const source = join(repositoryRoot, "node_modules");
  const names: string[] = [];
  for (const entry of await readdir(source)) {
    if (entry.startsWith(".")) continue;
    if (entry.startsWith("@")) for (const name of await readdir(join(source, entry))) names.push(join(entry, name));
    else names.push(entry);
  }
  const links: string[] = [];
  for (const name of names) {
    const link = join(directory, name);
    await mkdir(dirname(link), { recursive: true });
    await linkDirectory(await realpath(join(source, name)), link);
    links.push(link);
  }
  return links;
}

/**
 * Creates {@link tempProjectsRoot}, its mirror of the repository's `node_modules` and a
 * `package.json` with `"type": "module"`: inside the repository the projects inherited the
 * repository's, and without it Node would load their compiled `.ts` files as CommonJS, with a
 * second copy of the runtime. A project that writes its own `package.json` overrides it.
 */
async function prepareTempProjectsRoot(): Promise<void> {
  await mkdir(tempProjectsRoot, { recursive: true });
  await writeFile(join(tempProjectsRoot, "package.json"), `${JSON.stringify({ private: true, type: "module" })}\n`);
  const modules = join(tempProjectsRoot, "node_modules");
  // Earlier runs linked the whole folder: remove that link, never what it points to.
  if ((await lstat(modules).catch(() => undefined))?.isSymbolicLink()) {
    await unlink(modules).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  await linkRepositoryDependencies(modules);
}

/**
 * Links packages of the repository into `<root>/node_modules`, as an install would:
 * `@meekojs/meeko` is the repository itself (its `exports` point to `dist/`); any other
 * name is the repository's own dependency, e.g. `vite` or `@types/node`, linked to its real
 * directory for the reason given in {@link linkRepositoryDependencies}.
 */
export async function linkRepositoryPackages(root: string, names: readonly string[] = ["@meekojs/meeko"]): Promise<void> {
  for (const name of names) {
    const link = join(root, "node_modules", ...name.split("/"));
    await mkdir(dirname(link), { recursive: true });
    const target = name === "@meekojs/meeko" ? repositoryRoot : await realpath(join(repositoryRoot, "node_modules", ...name.split("/")));
    await symlink(target, link, "junction");
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
