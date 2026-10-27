import { escapeHtml } from "../server.js";

/**
 * Renders a development stylesheet that the client bundle also imports. Vite's client adopts a link
 * whose `data-vite-dev-id` names the CSS module: it skips the duplicate `<style>` and hot-swaps the link.
 */
export function devStylesheetLink(path: string, moduleId: string): string {
  return `<link rel="stylesheet" href="${escapeHtml(path)}" data-vite-dev-id="${escapeHtml(moduleId)}">`;
}
