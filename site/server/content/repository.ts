import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The public repository whose files the site renders and links to. */
export const repositoryUrl = "https://github.com/meekojs/meeko";

/** Production origin of the site. */
export const siteOrigin = "https://meeko.diegootayza.com";

let root: string | undefined;

/** Whether `directory` is the root of the Meeko repository: the package and its documents. */
function isRepository(directory: string): boolean {
  const manifest = join(directory, "package.json");
  if (!existsSync(manifest) || !existsSync(join(directory, "docs", "framework.md")) || !existsSync(join(directory, "CHANGELOG.md"))) return false;
  try { return (JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }).name === "@meekojs/meeko"; }
  catch { return false; }
}

/**
 * Root of the Meeko repository, found from the working directory or from this module: the site
 * lives in `site/`, and in dev, check and build its server code runs from there or from `.meeko/`.
 */
export function repositoryRoot(): string {
  if (root) return root;
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    for (let directory = resolve(start); ; directory = dirname(directory)) {
      if (isRepository(directory)) return (root = directory);
      if (dirname(directory) === directory) break;
    }
  }
  throw new Error(`The Meeko repository was not found above ${starts.join(" or ")}; build the site from its site/ folder`);
}

/** Text of a file of the repository, by its path from the root (`docs/api.md`). */
export function readRepositoryFile(path: string): string {
  return readFileSync(join(repositoryRoot(), ...path.split("/")), "utf8").replace(/\r\n?/g, "\n");
}

/** GitHub URL of a file or folder of the repository. */
export function githubUrl(path: string, kind: "blob" | "tree" | "edit" = "blob"): string {
  return `${repositoryUrl}/${kind}/main/${path.replace(/^\/+/, "")}`;
}
