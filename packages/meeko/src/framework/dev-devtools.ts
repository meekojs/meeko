import type { Plugin } from "vite";

import { fileURLToPath } from "node:url";

import type { DevtoolsPanelPosition } from "../devtools-ui/index";

/** The positions of the panel, as `mountDevtoolsPanel` accepts them. */
const positions = ["bottom-right", "bottom-left", "top-right", "top-left"] as const satisfies readonly DevtoolsPanelPosition[];

/** `devtools` of `meeko.config.ts`, normalized: what `meeko dev` mounts. */
export interface ResolvedDevtools {
  /** Whether `meeko dev` mounts the in-page panel. */
  readonly panel: boolean;
  /** Corner of the panel. */
  readonly position: DevtoolsPanelPosition;
}

/**
 * Checks and normalizes `devtools`: `undefined` and `false` turn it off (the 1.x default), `true`
 * mounts the panel, and an object turns it on with `panel` (default `true`) and `position`.
 * `label` names the option in the messages (`<file>: devtools`).
 */
export function resolveDevtoolsConfig(value: unknown, label = "devtools"): ResolvedDevtools {
  if (value === undefined || value === false) return { panel: false, position: "bottom-right" };
  if (value === true) return { panel: true, position: "bottom-right" };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} debe ser un booleano o un objeto { panel?: boolean, position?: ${positions.map((entry) => JSON.stringify(entry)).join(" | ")} }`);
  }
  const options = value as Record<string, unknown>;
  for (const name of Object.keys(options)) {
    if (name !== "panel" && name !== "position") throw new TypeError(`${label}: campo desconocido ${name}; devtools admite panel y position`);
  }
  if (options.panel !== undefined && typeof options.panel !== "boolean") throw new TypeError(`${label}.panel debe ser un booleano`);
  if (options.position !== undefined && !positions.includes(options.position as DevtoolsPanelPosition)) {
    throw new TypeError(`${label}.position debe ser ${positions.slice(0, -1).map((entry) => JSON.stringify(entry)).join(", ")} o ${JSON.stringify(positions.at(-1))}`);
  }
  return { panel: options.panel !== false, position: (options.position as DevtoolsPanelPosition | undefined) ?? "bottom-right" };
}

/** Whether this copy of Meeko lives in `node_modules`, where Vite optimizes it for the browser. */
const installedRuntime = fileURLToPath(new URL(".", import.meta.url)).replaceAll("\\", "/").includes("/node_modules/");

/** Vite id of the browser module that mounts the panel. */
const panelModuleId = "\0meeko:devtools-panel";
/** URL of that module, as Vite serves a virtual module. */
export const devtoolsPanelUrl = "/@id/__x00__meeko:devtools-panel";

/**
 * The `<script>` that `meeko dev` adds to the `<head>` of every document when the panel is on. A
 * module script runs once the document is parsed, so `document.body` exists; the panel connects
 * to the hook when hydration installs it (`meeko:devtools-ready`).
 */
export function devtoolsPanelScript(nonce: string | undefined, escape: (value: string) => string): string {
  return `<script type="module" async${nonce ? ` nonce="${escape(nonce)}"` : ""} src="${devtoolsPanelUrl}"></script>`;
}

/**
 * The plugin of `meeko dev` that serves the browser module of the panel. It only exists in `meeko
 * dev` (`apply: "serve"`), and the build never adds {@link devtoolsPanelScript}: the panel and
 * `@meekojs/meeko/devtools-ui` never reach `meeko build`, `meeko start` or a prerendered page.
 * A panel already in the page (mounted by the application) is kept and no second one is added.
 */
export function devtoolsPanelPlugin(options: ResolvedDevtools): Plugin {
  return {
    name: "meeko:devtools-panel",
    apply: "serve",
    // When Vite optimizes Meeko (installed in node_modules, not linked), the panel joins the first
    // optimization: found on the first page load, it would make Vite optimize again and reload.
    configEnvironment(name, config) {
      if (name !== "client" || !installedRuntime) return undefined;
      if (config.optimizeDeps?.exclude?.some((entry) => entry === "@meekojs/meeko" || entry.startsWith("@meekojs/meeko/"))) return undefined;
      return { optimizeDeps: { include: ["@meekojs/meeko/devtools-ui"] } };
    },
    resolveId(id) { return id === panelModuleId ? id : undefined; },
    load(id) {
      if (id !== panelModuleId) return undefined;
      return `import { mountDevtoolsPanel } from "@meekojs/meeko/devtools-ui";
if (!document.querySelector("[data-meeko-devtools-panel]")) mountDevtoolsPanel({ position: ${JSON.stringify(options.position)} });
`;
    },
  };
}
