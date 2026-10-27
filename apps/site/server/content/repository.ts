import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The public repository whose files the site renders and links to. */
export const repositoryUrl = "https://github.com/meekojs/meeko";

/** Production origin of the site. */
export const siteOrigin = "https://meeko.diegootayza.com";

/** Folder of the package `@meekojs/meeko` in the repository. */
export const packageFolder = "packages/meeko";

let root: string | undefined;

/** Whether `directory` is the root of the Meeko repository: the workspace, its documents and the package. */
function isRepository(directory: string): boolean {
  const manifest = join(directory, ...packageFolder.split("/"), "package.json");
  if (!existsSync(join(directory, "pnpm-workspace.yaml")) || !existsSync(join(directory, "docs", "framework.md")) || !existsSync(manifest)) return false;
  try { return (JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }).name === "@meekojs/meeko"; }
  catch { return false; }
}

/**
 * Root of the Meeko repository, found from the working directory or from this module: the site
 * lives in `apps/site/`, and in dev, check and build its server code runs from there or from `.meeko/`.
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
  throw new Error(`The Meeko repository was not found above ${starts.join(" or ")}; build the site from its apps/site/ folder`);
}

/**
 * Path from the repository root of a path the site uses. The site documents `@meekojs/meeko`, so a
 * path that exists in the package is the package's: `README.md` (the quick start), `CHANGELOG.md`,
 * `package.json` and `examples/…` resolve under `packages/meeko/`. Any other path, such as
 * `docs/api.md` or `packages/vscode/README.md`, is already relative to the repository root.
 */
export function repositoryPath(path: string): string {
  const clean = path.replace(/^\/+/, "");
  if (clean === packageFolder || clean.startsWith(`${packageFolder}/`)) return clean;
  return clean && existsSync(join(repositoryRoot(), ...packageFolder.split("/"), ...clean.split("/"))) ? `${packageFolder}/${clean}` : clean;
}

/** The inverse of {@link repositoryPath}: a path of the package without its folder (`packages/meeko/README.md` → `README.md`). */
export function sitePath(path: string): string {
  const clean = path.replace(/^\/+/, "");
  return clean.startsWith(`${packageFolder}/`) ? clean.slice(packageFolder.length + 1) : clean;
}

/** Text of a file of the repository, by its path from the root (`docs/api.md`) or from the package (`README.md`). */
export function readRepositoryFile(path: string): string {
  return readFileSync(join(repositoryRoot(), ...repositoryPath(path).split("/")), "utf8").replace(/\r\n?/g, "\n");
}

/** GitHub URL of a file or folder of the repository, by the same paths as {@link readRepositoryFile}. */
export function githubUrl(path: string, kind: "blob" | "tree" | "edit" = "blob"): string {
  return `${repositoryUrl}/${kind}/main/${repositoryPath(path)}`;
}
