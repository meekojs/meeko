import { escapeHtml } from "../server.js";

/** Renders stylesheet URLs from a Vite manifest or the development convention. */
export function stylesheetLinks(paths: readonly string[]): string {
  return paths.map((path) => `<link rel="stylesheet" href="${escapeHtml(path)}">`).join("");
}
