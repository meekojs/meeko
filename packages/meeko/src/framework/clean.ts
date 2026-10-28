import { chmod, lstat, readdir, readFile, realpath, rmdir, stat, unlink } from "node:fs/promises";
import type { Stats } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface CleanOptions {
  /** Also removes the project's `node_modules`. */
  readonly all?: boolean;
  /** Measures what would be removed without removing anything. */
  readonly dryRun?: boolean;
}

export interface CleanTarget {
  /** Path relative to the project root, with `/` separators. */
  readonly path: string;
  readonly files: number;
  /** Symbolic links and junctions, removed as links and never followed. */
  readonly links: number;
  readonly bytes: number;
  /** False when some entry could not be removed; see `CleanResult.failures`. */
  readonly complete: boolean;
}

export interface CleanFailure {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface CleanResult {
  readonly root: string;
  readonly dryRun: boolean;
  readonly targets: readonly CleanTarget[];
  readonly skipped: readonly { readonly path: string; readonly reason: string }[];
  readonly failures: readonly CleanFailure[];
  /** Bytes removed, or that would be removed in a dry run. */
  readonly bytes: number;
}

/**
 * The only paths `meeko clean` removes, relative to the project root. Meeko
 * writes everything it generates under `.meeko/`; Vite runs with its default
 * cache directory.
 */
const generatedTargets = [".meeko", "node_modules/.vite"] as const;
const allTargets = [".meeko", "node_modules"] as const;
const configFiles = ["meeko.config.ts", "meeko.config.mts", "meeko.config.js", "meeko.config.mjs"] as const;
const packageName = "@meekojs/meeko";
/** Windows reports open files, antivirus scans and indexers as these codes. */
const transientCodes = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY", "EMFILE", "ENFILE"]);
const retryDelays = [50, 100, 200, 400, 800] as const;
const fileBatch = 32;

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN";
}

function within(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/** Same location; `path.relative` compares case-insensitively on Windows. */
function samePath(left: string, right: string): boolean {
  return relative(left, right) === "";
}

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); }
  catch { return false; }
}

/** `meeko.config.*` in `root`, or a `package.json` there that depends on `@meekojs/meeko`. */
export async function isMeekoProject(root: string): Promise<boolean> {
  for (const name of configFiles) if (await isFile(join(root, name))) return true;
  let manifest: unknown;
  try { manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")); }
  catch { return false; }
  if (!manifest || typeof manifest !== "object") return false;
  return (["dependencies", "devDependencies"] as const).some((field) => {
    const dependencies = (manifest as Record<string, unknown>)[field];
    return !!dependencies && typeof dependencies === "object" && Object.hasOwn(dependencies, packageName);
  });
}

/**
 * Resolves the directory to its real absolute path and refuses anything that
 * is not a Meeko project, a filesystem root, or the home directory or one of
 * its ancestors.
 */
export async function resolveCleanRoot(projectRoot: string): Promise<string> {
  const requested = resolve(projectRoot);
  let root: string;
  try { root = await realpath(requested); }
  catch (error) { throw new Error(`No se puede limpiar ${requested}: ${errorCode(error) === "ENOENT" ? "el directorio no existe" : (error as Error).message}`); }
  if (!(await stat(root)).isDirectory()) throw new Error(`No se puede limpiar ${root}: no es un directorio`);
  if (dirname(root) === root) throw new Error(`Meeko no limpia ${root}: es la raíz del sistema de archivos`);
  const home = await realpath(homedir()).catch(() => resolve(homedir()));
  if (within(root, home)) throw new Error(`Meeko no limpia ${root}: es la carpeta personal del usuario o la contiene`);
  if (!(await isMeekoProject(root))) {
    throw new Error(`Meeko no limpia ${root}: no es un proyecto Meeko (no tiene meeko.config.ts ni ${packageName} en dependencies o devDependencies de package.json)`);
  }
  return root;
}

interface Tally { files: number; links: number; bytes: number }

/** Removes a symbolic link or junction itself; the target is never touched. */
async function removeLink(path: string): Promise<void> {
  try { await unlink(path); }
  catch (error) {
    // A directory junction or symlink on Windows may need rmdir; without
    // recursion rmdir deletes only the reparse point, or fails if it is a
    // real non-empty directory.
    if (process.platform === "win32" && (errorCode(error) === "EPERM" || errorCode(error) === "EISDIR")) await rmdir(path);
    else throw error;
  }
}

async function removeFile(path: string): Promise<void> {
  try { await unlink(path); }
  catch (error) {
    // Read-only files cannot be unlinked on Windows. lstat said this is a
    // regular file, so chmod does not follow a link.
    if (process.platform !== "win32" || errorCode(error) !== "EPERM") throw error;
    await chmod(path, 0o666);
    await unlink(path);
  }
}

/**
 * Deletes a tree without following links: `lstat` decides every entry, links
 * are unlinked, and a directory is entered only when its real path is the
 * path being walked. `fs.rm({ recursive: true })` is not used because Node
 * does not document that it never follows Windows junctions.
 */
class TreeRemover {
  readonly failures: CleanFailure[] = [];

  constructor(private readonly dryRun: boolean) {}

  private async attempt(path: string, operation: () => Promise<void>): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
      try { await operation(); return true; }
      catch (error) {
        const code = errorCode(error);
        if (code === "ENOENT") return true;
        const wait = retryDelays[attempt];
        if (transientCodes.has(code) && wait !== undefined) { await delay(wait); continue; }
        this.failures.push({ path, code, message: error instanceof Error ? error.message : String(error) });
        return false;
      }
    }
  }

  private fail(path: string, error: unknown): false {
    this.failures.push({ path, code: errorCode(error), message: error instanceof Error ? error.message : String(error) });
    return false;
  }

  private async link(path: string, tally: Tally): Promise<boolean> {
    tally.links++;
    return this.dryRun || this.attempt(path, () => removeLink(path));
  }

  async entry(path: string, info: Stats, link: boolean, tally: Tally): Promise<boolean> {
    if (link || info.isSymbolicLink()) return this.link(path, tally);
    if (info.isDirectory()) return this.directory(path, tally);
    tally.files++;
    if (this.dryRun) { tally.bytes += info.size; return true; }
    const removed = await this.attempt(path, () => removeFile(path));
    if (removed) tally.bytes += info.size;
    return removed;
  }

  private async directory(path: string, tally: Tally): Promise<boolean> {
    let real: string;
    try { real = await realpath(path); }
    catch (error) { return errorCode(error) === "ENOENT" || this.fail(path, error); }
    // A reparse point that lstat does not report as a link, such as a volume
    // mount point, resolves elsewhere: remove the entry, never its contents.
    if (!samePath(real, path)) return this.link(path, tally);
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); }
    catch (error) { return errorCode(error) === "ENOENT" || this.fail(path, error); }
    let complete = true;
    const files: (() => Promise<boolean>)[] = [];
    for (const dirent of entries) {
      const child = join(path, dirent.name);
      let info: Stats;
      try { info = await lstat(child); }
      catch (error) {
        if (errorCode(error) !== "ENOENT") complete = this.fail(child, error);
        continue;
      }
      // Windows reports every reparse point as a link in readdir; trust either signal.
      const link = info.isSymbolicLink() || dirent.isSymbolicLink();
      if (!link && info.isDirectory()) complete = (await this.directory(child, tally)) && complete;
      else files.push(() => this.entry(child, info, link, tally));
    }
    for (let index = 0; index < files.length; index += fileBatch) {
      const results = await Promise.all(files.slice(index, index + fileBatch).map((remove) => remove()));
      if (results.includes(false)) complete = false;
    }
    if (this.dryRun) return complete;
    // Failures inside were already reported; rmdir would only add ENOTEMPTY.
    return complete && this.attempt(path, () => rmdir(path));
  }
}

/**
 * Removes what Meeko generates in a project: `.meeko/` and Vite's cache in
 * `node_modules/.vite`, plus `node_modules` with `all`. Only that fixed list
 * is touched, each path must live inside the real project root, and links
 * are removed as links without following them.
 */
export async function cleanProject(projectRoot: string, options: CleanOptions = {}): Promise<CleanResult> {
  const root = await resolveCleanRoot(projectRoot);
  const dryRun = options.dryRun === true;
  const remover = new TreeRemover(dryRun);
  const targets: CleanTarget[] = [];
  const skipped: { path: string; reason: string }[] = [];
  for (const target of options.all ? allTargets : generatedTargets) {
    const path = join(root, ...target.split("/"));
    const parent = dirname(path);
    let parentReal: string;
    try { parentReal = await realpath(parent); }
    catch (error) {
      if (errorCode(error) !== "ENOENT") remover.failures.push({ path: parent, code: errorCode(error), message: (error as Error).message });
      continue;
    }
    // The entry must sit in the project itself, not behind a linked parent
    // such as a node_modules that is a link to another directory.
    if (!samePath(parentReal, parent) || !within(root, parentReal)) {
      skipped.push({ path: target, reason: `${relative(root, parent).split(sep).join("/")} es un enlace a ${parentReal}` });
      continue;
    }
    let info: Stats;
    try { info = await lstat(path); }
    catch (error) {
      if (errorCode(error) !== "ENOENT") remover.failures.push({ path, code: errorCode(error), message: (error as Error).message });
      continue;
    }
    const tally: Tally = { files: 0, links: 0, bytes: 0 };
    const complete = await remover.entry(path, info, false, tally);
    targets.push({ path: target, ...tally, complete });
  }
  return { root, dryRun, targets, skipped, failures: remover.failures, bytes: targets.reduce((total, target) => total + target.bytes, 0) };
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/** Human-readable report for `meeko clean`; failures go to stderr. */
export function formatCleanResult(result: CleanResult): { readonly stdout: string; readonly stderr: string } {
  let stdout = "";
  let stderr = "";
  for (const target of result.targets) {
    const verb = result.dryRun ? "Se borraría" : target.complete ? "Borrado" : "Borrado en parte";
    const counts = [`${target.files} ${target.files === 1 ? "archivo" : "archivos"}`];
    if (target.links > 0) counts.push(`${target.links} ${target.links === 1 ? "enlace" : "enlaces"} (sin seguir)`);
    counts.push(formatBytes(target.bytes));
    stdout += `${verb} ${target.path} (${counts.join(", ")})\n`;
  }
  for (const skip of result.skipped) stderr += `Omitido ${skip.path}: ${skip.reason}\n`;
  for (const failure of result.failures) stderr += `No se puede borrar ${failure.path}: ${failure.message}\n`;
  if (result.targets.length === 0) stdout += `Nada que limpiar en ${result.root}\n`;
  else if (result.dryRun) stdout += `Se liberarían ${formatBytes(result.bytes)} en ${result.root} (simulación: no se ha borrado nada)\n`;
  else stdout += `Liberados ${formatBytes(result.bytes)} en ${result.root}\n`;
  return { stdout, stderr };
}
