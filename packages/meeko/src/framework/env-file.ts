import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

/**
 * The Node options of this process with every `--env-file` and `--env-file-if-exists` path resolved
 * against `origin`, the working directory they were written for. Node accepts both `--env-file=.env`
 * and `--env-file .env`; a child that inherits another working directory would otherwise read a
 * different file or fail with "not found".
 */
export function resolveEnvFileArguments(execArgv: readonly string[], origin: string): string[] {
  const resolved = [...execArgv];
  resolved.forEach((argument, position) => {
    const joined = /^(--env-file(?:-if-exists)?)=(.+)$/.exec(argument);
    if (joined) resolved[position] = `${joined[1]}=${resolve(origin, joined[2]!)}`;
    else if ((argument === "--env-file" || argument === "--env-file-if-exists") && position + 1 < resolved.length) {
      resolved[position + 1] = resolve(origin, resolved[position + 1]!);
    }
  });
  return resolved;
}
