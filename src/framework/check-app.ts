import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { checkSource } from "../check.js";
import type { CompileDiagnostic } from "../compiler/sfc.js";
import { generateTypes } from "../types.js";
import { resolveConfigSources } from "./config.js";

async function appMeekoFiles(projectRoot: string): Promise<string[]> {
  const root = resolve(projectRoot);
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".meeko")) files.push(path);
    }
  }
  for (const source of await resolveConfigSources(root)) {
    await walk(join(source.root, "app", "pages"));
    await walk(join(source.root, "app", "components"));
    for (const file of [join(source.root, "app", "app.meeko"), join(source.root, "app", "error.meeko")]) {
      try { await readFile(file); files.push(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
  return files.sort();
}

/** Checks every discovered application component, including new pages and layouts. */
export async function checkApp(projectRoot: string): Promise<CompileDiagnostic[]> {
  const diagnostics: CompileDiagnostic[] = [];
  for (const file of await appMeekoFiles(projectRoot)) diagnostics.push(...await checkSource(await readFile(file, "utf8"), file));
  return diagnostics;
}

/** Mirrors app component declarations into the project's virtual type tree. */
export async function generateAppTypes(projectRoot: string): Promise<string[]> {
  const outputs = new Set<string>();
  for (const file of await appMeekoFiles(projectRoot)) {
    for (const output of await generateTypes(await readFile(file, "utf8"), file)) outputs.add(output);
  }
  return [...outputs].sort();
}
