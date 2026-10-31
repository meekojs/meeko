import { existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { readMeekoConfigSync } from "./config";

interface DoctorCheck {
  readonly id: string;
  readonly status: "ok" | "warning" | "error";
  readonly message: string;
}
interface PackageInfo {
  readonly name: string;
  readonly version?: string;
  readonly directory?: string;
  readonly entry?: string;
  readonly languageServer?: string;
}
/** Informe local sin ejecutar meeko.config ni módulos, cargar .env o modificar el proyecto. */
export interface DoctorReport {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly node: string;
  readonly projectKind: "application" | "workspace" | "unknown";
  readonly packageManager?: string;
  readonly packages: readonly PackageInfo[];
  readonly config: { readonly mode: "static"; readonly file?: string; readonly modules: readonly string[]; readonly layers: readonly string[] };
  readonly generated: readonly { readonly file: string; readonly exists: boolean }[];
  readonly languageServer: { readonly source: "project" | "unavailable"; readonly file?: string; readonly note: string };
  readonly checks: readonly DoctorCheck[];
  readonly ok: boolean;
}

function manifest(file: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

function packageInfo(root: string, name: string, workspace: boolean): PackageInfo {
  const require = createRequire(join(root, "package.json"));
  let entry: string | undefined;
  try { entry = require.resolve(name); } catch { /* Optional or not yet built. */ }
  let directory = entry ? dirname(entry) : join(root, "node_modules", ...name.split("/"));
  if (!entry && workspace && name.startsWith("@meekojs/")) directory = join(root, "packages", name.slice("@meekojs/".length));
  while (true) {
    const metadata = manifest(join(directory, "package.json"));
    if (metadata?.name === name) {
      const bin = metadata.bin;
      const server = bin && typeof bin === "object" ? (bin as Record<string, unknown>)["meeko-language-server"] : undefined;
      const candidate = typeof server === "string" ? resolve(directory, server) : undefined;
      const inside = candidate ? relative(directory, candidate) : undefined;
      const languageServer = candidate && inside !== undefined && !isAbsolute(inside) && inside !== ".." && !inside.startsWith("..\\") && !inside.startsWith("../") && existsSync(candidate) ? candidate : undefined;
      return { name, ...(typeof metadata.version === "string" ? { version: metadata.version } : {}), directory, ...(entry ? { entry } : {}), ...(languageServer ? { languageServer } : {}) };
    }
    if (!entry) break;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return { name };
}

/** Recoge versiones y artefactos disponibles, sin abrir conexiones ni ejecutar la configuración. */
export async function diagnoseProject(directory: string): Promise<DoctorReport> {
  const root = resolve(directory);
  const found = await stat(root).catch(() => undefined);
  if (!found?.isDirectory()) throw new TypeError(`No existe el directorio ${root}`);
  const workspace = existsSync(join(root, "pnpm-workspace.yaml")) && existsSync(join(root, "packages", "meeko", "package.json"));
  const application = existsSync(join(root, "app"));
  const checks: DoctorCheck[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ id: "node", status: major >= 24 ? "ok" : "error", message: `Node ${process.versions.node}; Meeko requiere Node 24 o superior.` });
  const project = manifest(join(root, "package.json"));
  checks.push({ id: "manifest", status: project ? "ok" : "warning", message: project ? "package.json válido." : "Falta package.json o no es JSON válido." });
  const packages = ["@meekojs/meeko", "@meekojs/ui", "@meekojs/i18n", "@meekojs/eslint-plugin", "@meekojs/prettier-plugin", "typescript", "vite", "eslint", "prettier"].map((name) => packageInfo(root, name, workspace));
  const engine = packages.find((item) => item.name === "@meekojs/meeko")!;
  checks.push({ id: "meeko", status: engine.entry ? "ok" : "warning", message: engine.entry ? `Meeko ${engine.version ?? "sin versión"} resuelve desde el proyecto.` : "Meeko no resuelve desde este directorio; instala dependencias o construye el workspace." });
  const configFile = ["meeko.config.ts", "meeko.config.mts", "meeko.config.js", "meeko.config.mjs"].find((file) => existsSync(join(root, file)));
  let modules: readonly string[] = [];
  let layers: readonly string[] = [];
  try {
    const config = readMeekoConfigSync(root);
    modules = (config.modules ?? []).filter((entry): entry is string => typeof entry === "string");
    layers = [...config.extends ?? [], ...config.layers ?? []];
    checks.push({ id: "config", status: "ok", message: configFile ? "Configuración leída estáticamente: los módulos importados, las funciones y sus opciones no se ejecutan." : "Sin archivo de configuración; se aplican los valores por defecto." });
  } catch {
    // Do not echo arbitrary source/config error text, which may contain secrets.
    checks.push({ id: "config", status: "warning", message: "No se pudo leer la configuración estática. Revisa sus arrays literales de layers, modules e imports; no se ha ejecutado código." });
  }
  const generated = [".meeko/tsconfig.app.json", ".meeko/tsconfig.server.json", ".meeko/tsconfig.shared.json", ".meeko/types/routes.d.ts", ".meeko/generated/entry-client.ts"].map((file) => ({ file, exists: existsSync(join(root, file)) }));
  if (application) checks.push({ id: "generated", status: generated.every((item) => item.exists) ? "ok" : "warning", message: generated.every((item) => item.exists) ? "Los artefactos básicos de .meeko están presentes; esto no garantiza que estén actualizados." : "Faltan artefactos de .meeko; ejecuta meeko routes o meeko check para generarlos." });
  checks.push({ id: "language-server", status: engine.languageServer ? "ok" : "warning", message: engine.languageServer ? "Servidor de lenguaje del proyecto disponible." : "No se encontró el servidor de lenguaje del proyecto; el editor puede recurrir al incluido en su extensión." });
  return {
    schemaVersion: 1, root, node: process.versions.node,
    projectKind: workspace ? "workspace" : application ? "application" : "unknown",
    ...(typeof project?.packageManager === "string" && /^[a-z][a-z0-9-]*@[\w.+-]+$/.test(project.packageManager) ? { packageManager: project.packageManager } : {}),
    packages, config: { mode: "static", ...(configFile ? { file: configFile } : {}), modules, layers }, generated,
    languageServer: { source: engine.languageServer ? "project" : "unavailable", ...(engine.languageServer ? { file: engine.languageServer } : {}), note: "La elección efectiva del editor depende de la confianza del workspace y de su configuración; este informe no consulta ni modifica VS Code." },
    checks, ok: !checks.some((check) => check.status === "error"),
  };
}

/** Presentación legible del mismo informe emitido con --json. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines = [`Meeko doctor — ${report.root}`, `Proyecto: ${report.projectKind} · Node ${report.node}`, ""];
  for (const check of report.checks) lines.push(`${check.status === "ok" ? "OK" : check.status === "warning" ? "AVISO" : "ERROR"} ${check.message}`);
  lines.push("", "Paquetes:");
  for (const item of report.packages) if (item.version) lines.push(`  ${item.name}: ${item.version}`);
  lines.push("", report.languageServer.note, "No se ejecutaron módulos ni configuración, no se cargó .env y no se modificó ningún archivo.");
  return lines.join("\n") + "\n";
}
