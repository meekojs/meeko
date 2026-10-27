import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

/**
 * Loads `<root>/.env` into `process.env`, as Vite and Nuxt do in development: `meeko dev`, `build`,
 * `start`, `preview` and `check` read it, so `MEEKO_PORT`, `MEEKO_PUBLIC_ORIGIN` or the app's own secrets work
 * without exporting them in the shell. A variable that the environment already sets wins, so a
 * deployment's real environment is never overridden. Returns the names it set.
 */
export function loadProjectEnv(root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  let content: string;
  try { content = readFileSync(join(root, ".env"), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "EISDIR") return [];
    throw error;
  }
  const loaded: string[] = [];
  for (const [name, value] of Object.entries(parseEnv(content))) {
    if (env[name] !== undefined) continue;
    env[name] = value;
    loaded.push(name);
  }
  return loaded;
}
