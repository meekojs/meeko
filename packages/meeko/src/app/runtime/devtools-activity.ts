import type { DevtoolsActivity } from "../../core/devtools-protocol";

type ActivityKind = "navigation" | "data";
type Sink = (kind: ActivityKind, activity: DevtoolsActivity) => void;
type DataEnd = "ready" | "cancel" | "error";
const sinks = new WeakMap<Window, Sink>();
let sequence = 0;

/** Conecta sólo un navegador cuyo runtime de desarrollo ya ha instalado DevTools. */
export function installDevtoolsActivitySink(browser: Window, sink: Sink): void {
  sinks.set(browser, sink);
}

function emit(sink: Sink, kind: ActivityKind, activity: DevtoolsActivity): void {
  try { sink(kind, activity); }
  catch { /* La observabilidad no altera una navegación. */ }
}

export interface NavigationTrace {
  data(source: NonNullable<DevtoolsActivity["source"]>): (phase: DataEnd) => void;
  finish(phase: "commit" | "cancel" | "error"): void;
}

/** Sin DevTools no crea operaciones, temporizadores ni capturas de datos. */
export function traceNavigation(browser: Window, route: string | null): NavigationTrace | undefined {
  const sink = sinks.get(browser);
  if (!sink) return;
  const now = () => browser.performance?.now() ?? Date.now();
  const begin = (kind: ActivityKind, source?: DevtoolsActivity["source"]) => {
    const operationId = ++sequence;
    const started = now();
    let finished = false;
    emit(sink, kind, { operationId, route, phase: "start", ...(source ? { source } : {}) });
    return (phase: Exclude<DevtoolsActivity["phase"], "start">) => {
      if (finished) return;
      finished = true;
      emit(sink, kind, { operationId, route, phase, durationMs: Math.max(0, now() - started), ...(source ? { source } : {}) });
    };
  };
  return { data: (source) => begin("data", source), finish: begin("navigation") };
}

/** Registra el uso de caché sin guardar claves de recurso, endpoints ni valores. */
export function traceResourceCacheHit(browser: Window): void {
  const sink = sinks.get(browser);
  if (sink) emit(sink, "data", { operationId: ++sequence, route: null, phase: "ready", source: "cache", durationMs: 0 });
}
