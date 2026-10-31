import { lstat, mkdir, readdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const marker = "// @meeko-generated module-type v1\n";

/** Reconciles only declarations owned by modules; never follows a symlink outside the project. */
export async function generateModuleTypes(projectRoot: string, templates: ReadonlyMap<string, string>): Promise<string[]> {
  const root = await realpath(projectRoot);
  const directory = resolve(projectRoot, ".meeko", "types", "modules");
  async function checkedDirectory(path: string): Promise<void> {
    const location = relative(root, await realpath(path));
    if (isAbsolute(location) || location === ".." || location.startsWith(`..${sep}`)) throw new Error(`Module types escape the project: ${path}`);
  }
  for (const part of [resolve(projectRoot, ".meeko"), resolve(projectRoot, ".meeko", "types"), directory]) {
    await mkdir(part, { recursive: true });
    await checkedDirectory(part);
  }
  const current = new Set<string>();
  for (const [key, contents] of templates) {
    if (!/^[A-Za-z0-9_%.-]+\/[A-Za-z0-9_-]+\.d\.ts$/.test(key) || key.split("/").includes("..")) throw new Error(`Invalid module type path: ${key}`);
    const target = join(directory, ...key.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await checkedDirectory(dirname(target));
    const existing = await readdir(dirname(target), { withFileTypes: true });
    if (existing.some((entry) => entry.name === key.split("/").at(-1) && entry.isSymbolicLink())) throw new Error(`Module type is a symlink: ${target}`);
    const source = marker + contents;
    const previous = await readFile(target, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return undefined; });
    if (previous !== undefined && !previous.startsWith(marker)) throw new Error(`Module type is not owned by Meeko: ${target}`);
    if (previous !== source) await writeFile(target, source);
    current.add(target);
  }
  async function clean(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const target = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Module type is a symlink: ${target}`);
      if (entry.isDirectory()) await clean(target);
      else if (!current.has(target) && entry.name.endsWith(".d.ts") && (await readFile(target, "utf8")).startsWith(marker)) await unlink(target);
    }
  }
  await clean(directory);
  const index = join(dirname(directory), "modules.d.ts");
  if ((await lstat(index).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return undefined; }))?.isSymbolicLink()) throw new Error(`Module type is a symlink: ${index}`);
  const entries = [...current].map((file) => `/// <reference path=${JSON.stringify(`./modules/${relative(directory, file).replaceAll("\\", "/")}`)} />`);
  const previous = await readFile(index, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return undefined; });
  if (previous !== undefined && !previous.startsWith(marker)) throw new Error(`Module type is not owned by Meeko: ${index}`);
  const source = `${marker}${entries.join("\n")}\nexport {};\n`;
  if (previous !== source) await writeFile(index, source);
  return [index, ...current];
}
