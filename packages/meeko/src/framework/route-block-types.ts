import { mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { replaceModuleSpecifiers } from "../compiler/import-graph.js";
import { discoverConfiguredRoutes } from "./config.js";
import { MeekoCompileError } from "../compiler/sfc.js";
import { routeBlockFile, routeBlockSource } from "./route-block.js";
import { readServerScript, serverScriptTypes } from "./server-script.js";

/** Directory, relative to `.meeko`, that mirrors `<script server>` blocks as TypeScript. */
export const routeBlockTypesDirectory = "routes";

/** Where the TypeScript copy of a page's `<script server>` block is written. */
export function routeBlockTypeFile(projectRoot: string, page: string): string {
  // A page on another drive yields an absolute path, and TypeScript skips
  // `node_modules` segments in globs, so both become plain directory names.
  const path = relative(projectRoot, page).split(/[\\/]/).map((segment) => segment === ".." ? "__parent__"
    : segment === "node_modules" ? "__node_modules__"
    : segment.replace(/^([A-Za-z]):$/, "__drive_$1__")).filter(Boolean).join(sep);
  return join(projectRoot, ".meeko", routeBlockTypesDirectory, `${path}.route.ts`);
}

/** Maps each generated block file to its `.meeko` page. */
export async function routeBlockTypeFiles(projectRoot: string): Promise<Map<string, string>> {
  return new Map([...await routeBlockPages(projectRoot)].map(([output, { page }]) => [output, page]));
}

async function routeBlockPages(projectRoot: string): Promise<Map<string, { page: string; id: string }>> {
  const root = resolve(projectRoot);
  const files = new Map<string, { page: string; id: string }>();
  for (const route of await discoverConfiguredRoutes(root)) {
    const page = route.sidecar ? routeBlockFile(route.sidecar) : undefined;
    if (page) files.set(routeBlockTypeFile(root, page), { page, id: route.id });
  }
  return files;
}

/**
 * The `<script server>` block of `page` as TypeScript, with the offsets of the
 * `.meeko` file. Top-level code gets its typed `usePage()` and request APIs.
 */
export function routeBlockTypeSource(source: string, page: string, routeId: string | undefined): string | undefined {
  const block = routeBlockSource(source, page);
  if (block === undefined) return undefined;
  let read;
  // A block that does not compile is reported by the page's own check.
  try { read = readServerScript(source, page); }
  catch (error) { if (error instanceof MeekoCompileError) return block; throw error; }
  return read ? serverScriptTypes(block, 0, read.script, routeId) : block;
}

async function listFiles(directory: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await listFiles(path));
    else found.push(path);
  }
  return found;
}

/**
 * Writes each `<script server>` block to `.meeko/routes` so the server
 * TypeScript project checks it like a `.route.ts` sidecar. Lines and columns
 * match the `.meeko` file except inside rewritten relative import specifiers.
 */
export async function generateRouteBlockTypes(projectRoot: string): Promise<Map<string, string>> {
  const root = resolve(projectRoot);
  const pages = await routeBlockPages(root);
  const files = new Map([...pages].map(([output, { page }]) => [output, page]));
  for (const [output, { page, id }] of pages) {
    const block = routeBlockTypeSource(await readFile(page, "utf8"), page, id);
    if (block === undefined) continue;
    const source = replaceModuleSpecifiers(block, output, ({ value }) => {
      if (!value.startsWith(".")) return value;
      const target = relative(dirname(output), resolve(dirname(page), value)).replaceAll("\\", "/");
      return target.startsWith(".") ? target : `./${target}`;
    });
    await mkdir(dirname(output), { recursive: true });
    let previous: string | undefined;
    try { previous = await readFile(output, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (previous !== source) await writeFile(output, source, "utf8");
  }
  const directory = join(root, ".meeko", routeBlockTypesDirectory);
  for (const file of await listFiles(directory)) {
    if (!files.has(file)) await unlink(file);
  }
  if (files.size === 0) await rm(directory, { recursive: true, force: true });
  return files;
}

/** Rewrites generated block paths in TypeScript output to their `.meeko` pages. */
export function mapRouteBlockPaths(output: string, files: ReadonlyMap<string, string>, cwd = process.cwd()): string {
  let mapped = output;
  for (const [generated, page] of files) {
    for (const [from, to] of [[generated, page], [relative(cwd, generated), relative(cwd, page)]] as const) {
      mapped = mapped.split(from).join(to).split(from.replaceAll("\\", "/")).join(to.replaceAll("\\", "/"));
    }
  }
  return mapped;
}
