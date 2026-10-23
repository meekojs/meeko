// @ts-check

/** @typedef {{id:string,componentId:string,name:string,file:string,props:unknown,signals:Record<string,unknown>,parentId:string|null,childIds:string[],status:string,breakpoint:boolean}} DevtoolsInstance */
/** @typedef {{id:number,at:number,kind:string,instanceId:string,detail?:string}} DevtoolsEvent */
/** @typedef {{instances:DevtoolsInstance[],events:DevtoolsEvent[],selectedId:string|null}} DevtoolsSnapshot */

const commands = new Set(["select", "highlight", "setBreakpoint"]);

/** Produce una expresión fija que devuelve datos serializables de la página. */
export function snapshotExpression() {
  return "(() => { const bridge = window.__MEEKO_DEVTOOLS__; return bridge && typeof bridge.snapshot === 'function' ? bridge.snapshot() : null; })()";
}

/** Genera una llamada segura a una operación conocida del puente. */
export function commandExpression(/** @type {'select'|'highlight'|'setBreakpoint'} */ command, /** @type {unknown[]} */ args) {
  if (!commands.has(command)) throw new TypeError("Unknown Meeko DevTools command");
  const encoded = args.map((argument) => JSON.stringify(argument)).join(", ");
  return `(() => { const bridge = window.__MEEKO_DEVTOOLS__; if (!bridge || typeof bridge.${command} !== 'function') return { ok: false, error: 'Meeko DevTools unavailable' }; bridge.${command}(${encoded}); return { ok: true }; })()`;
}

/** Acepta sólo el contrato serializable esperado por el panel. */
export function normalizeSnapshot(/** @type {unknown} */ value) {
  if (!value || typeof value !== "object") return null;
  const raw = /** @type {Record<string,unknown>} */ (value);
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
      props: item.props,
      signals: item.signals && typeof item.signals === "object" && !Array.isArray(item.signals) ? /** @type {Record<string,unknown>} */ (item.signals) : {},
      parentId: typeof item.parentId === "string" ? item.parentId : null,
      childIds: Array.isArray(item.childIds) ? item.childIds.filter((id) => typeof id === "string") : [],
      status: typeof item.status === "string" ? item.status : "hydrated",
      breakpoint: item.breakpoint === true,
    });
  }
  /** @type {DevtoolsEvent[]} */
  const events = [];
  for (const entry of raw.events) {
    if (!entry || typeof entry !== "object") continue;
    const item = /** @type {Record<string,unknown>} */ (entry);
    if (typeof item.id !== "number" || !Number.isFinite(item.id) || typeof item.at !== "number" || !Number.isFinite(item.at) || Math.abs(item.at) > 8.64e15 || typeof item.kind !== "string" || typeof item.instanceId !== "string") continue;
    const event = { id: item.id, at: item.at, kind: item.kind, instanceId: item.instanceId };
    events.push(typeof item.detail === "string" ? { ...event, detail: item.detail } : event);
  }
  return {
    instances,
    events,
    selectedId: typeof raw.selectedId === "string" ? raw.selectedId : null,
  };
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
