import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Folders whose declaration files belong to every TypeScript program of a component. */
const declarationFolders = ["app", "server", "shared"] as const;

/** Lists are reused this long: the editor asks for them on every program update. */
const cacheMs = 1000;
const cache = new Map<string, { readonly at: number; readonly files: readonly string[] }>();

/**
 * The project's own declaration files under `app/`, `server/` and `shared/`, such as a
 * `MeekoSession` augmentation in `server/types/session.d.ts`. The generated app, server and shared
 * projects include them through their globs; the program of a single component (in `meeko check`
 * and in the editor) only reaches the files it imports, so it adds these explicitly. Generated
 * `.d.meeko.ts` declarations and `node_modules` are left out.
 */
export function projectDeclarationFiles(root: string): readonly string[] {
  const now = Date.now();
  const cached = cache.get(root);
  if (cached && now - cached.at < cacheMs) return cached.files;
  const files: string[] = [];
  for (const folder of declarationFolders) {
    const directory = join(root, folder);
    if (!existsSync(directory)) continue;
    let entries;
    try { entries = readdirSync(directory, { recursive: true, withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".d.ts") || entry.name.endsWith(".d.meeko.ts")) continue;
      const path = join(entry.parentPath, entry.name);
      if (relative(directory, path).split(sep).includes("node_modules")) continue;
      files.push(path);
    }
  }
  files.sort();
  cache.set(root, { at: now, files });
  return files;
}
