// @ts-check

// Los tipos proceden de src/devtools-protocol.ts mediante types/protocol.d.ts (pnpm run devtools:types).
/** @typedef {import('./types/protocol.js').DevtoolsHook} DevtoolsHook */
/** @typedef {import('./types/protocol.js').DevtoolsInstance} DevtoolsInstance */
/** @typedef {import('./types/protocol.js').DevtoolsEvent} DevtoolsEvent */
/** @typedef {import('./types/protocol.js').DevtoolsEventKind} DevtoolsEventKind */
/** @typedef {import('./types/protocol.js').DevtoolsReadSite} DevtoolsReadSite */
/** @typedef {import('./types/protocol.js').DevtoolsReadKind} DevtoolsReadKind */
/** @typedef {import('./types/protocol.js').DevtoolsWriteSite} DevtoolsWriteSite */
/** @typedef {import('./types/protocol.js').DevtoolsSnapshot} DevtoolsSnapshot */
/** @typedef {import('./types/protocol.js').DevtoolsValue} DevtoolsValue */
/** @typedef {import('./types/protocol.js').DevtoolsCommandResult} DevtoolsCommandResult */
/** @typedef {'select'|'highlight'|'setBreakpoint'|'setSignal'} DevtoolsCommand */

/** Única versión del protocolo que entiende esta extensión. */
/** @type {import('./types/protocol.js').DevtoolsProtocolVersion} */
export const SUPPORTED_PROTOCOL_VERSION = 1;

/** @type {ReadonlySet<string>} */
const commands = new Set(["select", "highlight", "setBreakpoint", "setSignal"]);
/** @type {ReadonlySet<string>} */
const eventKinds = new Set(/** @type {DevtoolsEventKind[]} */ (["mount", "unmount", "signal", "breakpoint", "select", "hmr"]));
/** @type {ReadonlySet<string>} */
const readKinds = new Set(/** @type {DevtoolsReadKind[]} */ (["text", "attribute", "computed", "if", "each", "prop"]));

/** Produce una expresión fija que devuelve datos serializables de la página. */
export function snapshotExpression() {
  return "(() => { const bridge = window.__MEEKO_DEVTOOLS__; return bridge && typeof bridge.snapshot === 'function' ? bridge.snapshot() : null; })()";
}

/**
 * Genera una llamada segura a una operación conocida del puente.
 * Los argumentos se codifican como JSON y el resultado siempre es `{ ok, error? }`.
 * @template {DevtoolsCommand} K
 * @param {K} command
 * @param {Parameters<DevtoolsHook[K]>} args
 */
export function commandExpression(command, args) {
  if (!commands.has(command)) throw new TypeError("Unknown Meeko DevTools command");
  const encoded = args.map((argument) => JSON.stringify(argument)).join(", ");
  return `(() => { const bridge = window.__MEEKO_DEVTOOLS__; if (!bridge || typeof bridge.${command} !== 'function') return { ok: false, error: 'Meeko DevTools unavailable' }; if (bridge.protocolVersion !== ${SUPPORTED_PROTOCOL_VERSION}) return { ok: false, error: 'Unsupported Meeko DevTools protocol' }; try { const result = bridge.${command}(${encoded}); if (result && typeof result === 'object' && result.ok === false) return { ok: false, error: String(result.error) }; return { ok: true }; } catch (error) { return { ok: false, error: String(error && error.message || error) }; } })()`;
}

/**
 * Acepta sólo el resultado `{ ok, error? }` que produce `commandExpression`.
 * @param {unknown} value
 * @returns {DevtoolsCommandResult}
 */
export function normalizeCommandResult(value) {
  if (!value || typeof value !== "object") return { ok: false, error: "Meeko DevTools no respondió" };
  const raw = /** @type {Record<string, unknown>} */ (value);
  if (raw.ok === true) return { ok: true };
  return { ok: false, error: typeof raw.error === "string" && raw.error ? raw.error : "Operación rechazada" };
}

/**
 * Explica por qué una captura usa un protocolo distinto del admitido; `null` si es compatible o no hay runtime.
 * @param {unknown} value
 * @returns {string | null}
 */
export function protocolMismatch(value) {
  if (!value || typeof value !== "object") return null;
  const version = /** @type {Record<string, unknown>} */ (value).protocolVersion;
  if (version === SUPPORTED_PROTOCOL_VERSION) return null;
  if (version === undefined) {
    return `La página usa un runtime Meeko sin versión de protocolo (anterior a 1.0). Esta extensión admite el protocolo ${SUPPORTED_PROTOCOL_VERSION}: actualiza @meekojs/meeko o usa la extensión 0.x.`;
  }
  const shown = typeof version === "number" && Number.isFinite(version) ? String(version) : JSON.stringify(version);
  const advice = typeof version === "number" && version > SUPPORTED_PROTOCOL_VERSION ? "Actualiza la extensión Meeko DevTools." : "Usa una versión de @meekojs/meeko compatible con esta extensión.";
  return `La página usa el protocolo DevTools ${shown} y esta extensión admite el ${SUPPORTED_PROTOCOL_VERSION}. ${advice}`;
}

/**
 * Los datos ya pasaron por JSON en `inspectedWindow.eval`; `undefined` se representa como `null`.
 * @param {unknown} value
 * @returns {DevtoolsValue}
 */
function jsonValue(value) {
  return value === undefined ? null : /** @type {DevtoolsValue} */ (value);
}

/** @param {unknown} value */
function isPosition(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * @param {unknown} value
 * @returns {DevtoolsReadSite | null}
 */
function normalizeRead(value) {
  if (!value || typeof value !== "object") return null;
  const read = /** @type {Record<string, unknown>} */ (value);
  if (typeof read.file !== "string" || typeof read.expression !== "string" || !isPosition(read.line) || !isPosition(read.column)) return null;
  if (typeof read.kind !== "string" || !readKinds.has(read.kind)) return null;
  /** @type {DevtoolsReadSite} */
  const site = { file: read.file, line: /** @type {number} */ (read.line), column: /** @type {number} */ (read.column), expression: read.expression, kind: /** @type {DevtoolsReadKind} */ (read.kind) };
  if (typeof read.name === "string") site.name = read.name;
  return site;
}

/**
 * @param {unknown} value
 * @returns {DevtoolsWriteSite | undefined}
 */
function normalizeWrite(value) {
  if (!value || typeof value !== "object") return undefined;
  const write = /** @type {Record<string, unknown>} */ (value);
  if (write.kind === "devtools") return { kind: "devtools" };
  if (write.kind !== "assignment" || typeof write.file !== "string" || typeof write.expression !== "string" || !isPosition(write.line) || !isPosition(write.column)) return undefined;
  return { kind: "assignment", file: write.file, line: /** @type {number} */ (write.line), column: /** @type {number} */ (write.column), expression: write.expression };
}

/**
 * Acepta sólo el contrato serializable esperado por el panel en la versión admitida.
 * @param {unknown} value
 * @returns {DevtoolsSnapshot | null}
 */
export function normalizeSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  const raw = /** @type {Record<string,unknown>} */ (value);
  if (raw.protocolVersion !== SUPPORTED_PROTOCOL_VERSION) return null;
  if (!Array.isArray(raw.instances) || !Array.isArray(raw.events)) return null;
  /** @type {DevtoolsInstance[]} */
  const instances = [];
  for (const entry of raw.instances) {
    if (!entry || typeof entry !== "object") continue;
    const item = /** @type {Record<string,unknown>} */ (entry);
    if (typeof item.id !== "string" || typeof item.name !== "string") continue;
    instances.push({
      id: item.id,
      componentId: typeof item.componentId === "string" ? item.componentId : "",
      name: item.name,
      file: typeof item.file === "string" ? item.file : "",
      props: jsonValue(item.props),
      signals: item.signals && typeof item.signals === "object" && !Array.isArray(item.signals) ? /** @type {Record<string,DevtoolsValue>} */ (item.signals) : {},
      parentId: typeof item.parentId === "string" ? item.parentId : null,
      childIds: Array.isArray(item.childIds) ? item.childIds.filter((id) => typeof id === "string") : [],
      status: "hydrated",
      breakpoint: item.breakpoint === true,
    });
  }
  /** @type {DevtoolsEvent[]} */
  const events = [];
  for (const entry of raw.events) {
    if (!entry || typeof entry !== "object") continue;
    const item = /** @type {Record<string,unknown>} */ (entry);
    if (typeof item.id !== "number" || !Number.isFinite(item.id) || typeof item.at !== "number" || !Number.isFinite(item.at) || Math.abs(item.at) > 8.64e15) continue;
    if (typeof item.kind !== "string" || !eventKinds.has(item.kind) || typeof item.instanceId !== "string") continue;
    /** @type {DevtoolsEvent} */
    const event = { id: item.id, at: item.at, kind: /** @type {DevtoolsEventKind} */ (item.kind), instanceId: item.instanceId };
    if (typeof item.detail === "string") event.detail = item.detail;
    if (typeof item.componentName === "string") event.componentName = item.componentName;
    if (typeof item.file === "string") event.file = item.file;
    if (Object.hasOwn(item, "value")) event.value = jsonValue(item.value);
    if (Array.isArray(item.reads)) {
      /** @type {DevtoolsReadSite[]} */
      const reads = [];
      for (const read of item.reads) {
        const site = normalizeRead(read);
        if (site) reads.push(site);
        if (reads.length >= 30) break;
      }
      event.reads = reads;
    }
    const write = normalizeWrite(item.write);
    if (write) event.write = write;
    events.push(event);
  }
  return {
    protocolVersion: SUPPORTED_PROTOCOL_VERSION,
    instances,
    events,
    selectedId: typeof raw.selectedId === "string" ? raw.selectedId : null,
  };
}

/**
 * Convierte el texto del editor en un valor JSON o explica el error de sintaxis.
 * @param {string} text
 * @returns {{ ok: true, value: DevtoolsValue } | { ok: false, error: string }}
 */
export function parseSignalValue(text) {
  if (!text.trim()) return { ok: false, error: "Escribe un valor JSON, por ejemplo 0, \"texto\", true, null, [] o {}." };
  try {
    return { ok: true, value: /** @type {DevtoolsValue} */ (JSON.parse(text)) };
  } catch (error) {
    return { ok: false, error: `JSON no válido: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Nombre legible de la construcción que lee una señal. @param {DevtoolsReadSite} read */
export function readKindLabel(read) {
  /** @type {Record<DevtoolsReadKind, string>} */
  const labels = { text: "texto", attribute: "atributo", computed: "computed", if: "if:when", each: "each:of", prop: "prop" };
  return read.kind === "prop" && read.name ? `prop ${read.name}` : labels[read.kind];
}

/** Texto del origen de una escritura conocida. @param {DevtoolsWriteSite} write */
export function writeLabel(write) {
  return write.kind === "devtools" ? "Escrita desde DevTools" : `Escrita en ${write.file}:${write.line}:${write.column}`;
}

/** Agrupa las instancias por nombre y archivo del componente. */
export function groupInstances(/** @type {DevtoolsInstance[]} */ instances) {
  /** @type {Map<string,{key:string,name:string,file:string,instances:DevtoolsInstance[]}>} */
  const groups = new Map();
  for (const instance of instances) {
    const key = instance.componentId || `${instance.name}\u0000${instance.file}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, name: instance.name, file: instance.file, instances: [] };
      groups.set(key, group);
    }
    group.instances.push(instance);
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));
}
