import type { EditorLiveAlias, EditorLiveSignal } from "../../../meeko/src/devtools-bridge-protocol.js";

export type { EditorBridgeDescriptor, EditorBridgeEvent, EditorCommandResult, EditorLiveAlias, EditorLiveSignal } from "../../../meeko/src/devtools-bridge-protocol.js";

/** Descriptores del puente: cada `meeko dev` en marcha escribe el suyo, con su puerto en el nombre. */
export const bridgeDescriptorGlob = "**/.meeko/dev/editor-bridge-*.json";

/**
 * `true` si el descriptor, con su ruta relativa a la carpeta del workspace, es de un proyecto del
 * workspace. Se descartan los de paquetes en `node_modules` (un paquete enlazado con `link:` y sus
 * proyectos temporales) y los de proyectos dentro del `.meeko/` de otro (proyectos temporales de
 * herramientas y pruebas): sus valores no son del código del workspace.
 */
export function isWorkspaceBridgeDescriptor(path: string): boolean {
  const segments = path.split(/[\\/]/).filter(Boolean);
  const name = segments.at(-1) ?? "";
  if (!/^editor-bridge-\d+\.json$/.test(name) || segments.at(-2) !== "dev" || segments.at(-3) !== ".meeko") return false;
  const project = segments.slice(0, -3);
  return !project.some((segment) => segment === "node_modules" || segment === ".meeko");
}

/** Valores de una misma declaración de señal en todas las instancias montadas. */
export interface LiveGroup {
  name: string;
  /** Línea y columna (desde 1) que publicó el navegador. */
  line: number;
  column: number;
  signals: EditorLiveSignal[];
}

/** Grupo situado en el texto actual del documento; `line` empieza en 0. */
export interface LivePlacement {
  group: LiveGroup;
  line: number;
}

/** Clave de comparación de rutas: barras `/` y, en sistemas sin distinción de mayúsculas, minúsculas. */
export function fileKey(path: string, caseInsensitive: boolean): string {
  const normalized = path.replaceAll("\\", "/");
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

/** Agrupa por declaración las señales de `file`, con las instancias en orden estable. */
export function groupSignals(signals: Iterable<EditorLiveSignal>, file: string, caseInsensitive: boolean): LiveGroup[] {
  const key = fileKey(file, caseInsensitive);
  const groups = new Map<string, LiveGroup>();
  for (const signal of signals) {
    if (signal.line === undefined || signal.column === undefined || fileKey(signal.file, caseInsensitive) !== key) continue;
    const id = `${signal.name}@${signal.line}:${signal.column}`;
    let group = groups.get(id);
    if (!group) {
      group = { name: signal.name, line: signal.line, column: signal.column, signals: [] };
      groups.set(id, group);
    }
    group.signals.push(signal);
  }
  const order = (left: EditorLiveSignal, right: EditorLiveSignal): number =>
    left.tab.localeCompare(right.tab, "en", { numeric: true }) || left.instanceId.localeCompare(right.instanceId, "en", { numeric: true });
  return [...groups.values()].map((group) => ({ ...group, signals: group.signals.sort(order) })).sort((left, right) => left.line - right.line || left.column - right.column);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sitúa cada grupo en el texto actual. Si el documento cambió desde la última compilación y
 * el nombre ya no está en la posición publicada, usa la declaración más cercana con ese nombre.
 */
export function placeGroups(groups: readonly LiveGroup[], lines: readonly string[]): LivePlacement[] {
  const placements: LivePlacement[] = [];
  for (const group of groups) {
    const reported = group.line - 1;
    const text = lines[reported];
    const word = new RegExp(`^${escapeRegExp(group.name)}(?![\\w$])`);
    if (text !== undefined && word.test(text.slice(group.column - 1))) {
      placements.push({ group, line: reported });
      continue;
    }
    const declaration = new RegExp(`\\b(?:const|let|var|function)\\s+${escapeRegExp(group.name)}(?![\\w$])`);
    let best: number | undefined;
    for (const [index, candidate] of lines.entries()) {
      if (!declaration.test(candidate)) continue;
      if (best === undefined || Math.abs(index - reported) < Math.abs(best - reported)) best = index;
    }
    if (best !== undefined) placements.push({ group, line: best });
  }
  return placements;
}

/** JSON en una línea, recortado a `limit` caracteres. */
export function previewValue(signal: EditorLiveSignal, limit = 60): string {
  let text = signal.json;
  if (!signal.truncated) {
    try { text = JSON.stringify(JSON.parse(signal.json)); } catch { text = signal.json; }
  }
  const compact = text.replace(/\s+/g, " ");
  return compact.length > limit || signal.truncated ? `${compact.slice(0, limit - 1)}…` : compact;
}

/**
 * Texto de la decoración al final de la línea: `count = 3`, `count = 3 · 3 instancias` o, si la
 * señal es la del padre recibida con `defineModel`, `open = true (= dialogOpen)`.
 */
export function inlineText(group: LiveGroup, limit = 60): string {
  const first = group.signals[0];
  if (!first) return "";
  const count = group.signals.length;
  const alias = first.alias ? ` (= ${first.alias.name})` : "";
  return `${group.name} = ${previewValue(first, limit)}${alias}${count > 1 ? ` · ${count} instancias` : ""}`;
}

/** Nombre del archivo de una ruta con barras `/` o `\`. */
function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/** Código Markdown en línea que el contenido no puede cerrar. */
function inlineCode(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const marks = "`".repeat(longest + 1);
  return longest ? `${marks} ${text} ${marks}` : `${marks}${text}${marks}`;
}

/** Descripción de un alias para el hover: «alias de `dialogOpen` (lab.meeko:5)». */
export function aliasDescription(alias: EditorLiveAlias): string {
  const place = `${baseName(alias.file)}${alias.line === undefined ? "" : `:${alias.line}`}`;
  return `alias de ${inlineCode(alias.name)} (${escapeMarkdown(place)})`;
}

/** JSON con sangría para el hover; un valor recortado se muestra tal como llegó. */
export function formatValue(signal: EditorLiveSignal, limit = 4000): string {
  let text = signal.json;
  if (!signal.truncated) {
    try { text = JSON.stringify(JSON.parse(signal.json), null, 2); } catch { text = signal.json; }
  }
  return text.length > limit ? `${text.slice(0, limit)}\n…` : signal.truncated ? `${text}…` : text;
}

/** Bloque de código Markdown que no puede cerrarse desde el contenido. */
function fence(text: string, language: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const marks = "`".repeat(longest + 1);
  return `${marks}${language}\n${text}\n${marks}`;
}

/** Texto Markdown que no interpreta el contenido como formato. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}

/**
 * Markdown del hover de un grupo: valor completo de cada instancia y, si se da `editLink`,
 * un enlace para editarlo.
 */
export function hoverMarkdown(group: LiveGroup, editLink?: (signal: EditorLiveSignal) => string, maxInstances = 10): string {
  const parts: string[] = [];
  const count = group.signals.length;
  parts.push(`**Meeko live** · \`${group.name}\`${count > 1 ? ` · ${count} instancias` : ""}`);
  for (const signal of group.signals.slice(0, maxInstances)) {
    const header = `${escapeMarkdown(signal.component)} · ${escapeMarkdown(signal.instanceId)} · ${escapeMarkdown(signal.tab)}`;
    const alias = signal.alias ? ` · ${aliasDescription(signal.alias)}` : "";
    const edit = editLink ? ` · [Editar valor](${editLink(signal)})` : "";
    parts.push(`${header}${alias}${edit}${signal.truncated ? " · *recortado*" : ""}\n\n${fence(formatValue(signal), "json")}`);
  }
  if (count > maxInstances) parts.push(`… y ${count - maxInstances} instancias más`);
  return parts.join("\n\n");
}

export type ParsedValue = { ok: true; value: unknown } | { ok: false; error: string };

/** Valida el JSON que escribe el usuario para `setSignal`. */
export function parseEditedValue(text: string): ParsedValue {
  if (!text.trim()) return { ok: false, error: "Escribe un valor JSON, por ejemplo 3, \"texto\", true o null" };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: `JSON no válido: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Valor inicial del cuadro de edición: el JSON actual en una línea si es corto. */
export function editableValue(signal: EditorLiveSignal): string {
  if (signal.truncated) return "";
  try { return JSON.stringify(JSON.parse(signal.json)); } catch { return signal.json; }
}

/** URL HTTP de loopback válida para el puente, o `undefined`. */
export function loopbackBridgeUrl(url: unknown): URL | undefined {
  if (typeof url !== "string") return undefined;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return undefined; }
  if (parsed.protocol !== "http:" || parsed.username || parsed.password) return undefined;
  const host = parsed.hostname.startsWith("[") ? parsed.hostname.slice(1, -1) : parsed.hostname;
  const loopback = host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
  return loopback ? parsed : undefined;
}

/** Lector incremental de `text/event-stream`. */
export class SseParser {
  private buffer = "";

  constructor(private readonly onEvent: (event: string, data: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk.replace(/\r\n?/g, "\n");
    let end: number;
    while ((end = this.buffer.indexOf("\n\n")) >= 0) {
      const frame = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length) this.onEvent(event, data.join("\n"));
    }
  }
}
