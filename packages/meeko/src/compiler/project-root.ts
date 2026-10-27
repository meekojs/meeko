import { existsSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";

/** The package owns generated Meeko artifacts; a standalone TS project is a fallback. */
export function projectRoot(filename: string): string {
  let directory = dirname(resolve(filename));
  let tsProject: string | undefined;
  for (;;) {
    if (existsSync(resolve(directory, "package.json"))) return directory;
    if (!tsProject && existsSync(resolve(directory, "tsconfig.json"))) tsProject = directory;
    const parent = dirname(directory);
    if (parent === directory || directory === parse(directory).root) return tsProject ?? dirname(resolve(filename));
    directory = parent;
  }
}
