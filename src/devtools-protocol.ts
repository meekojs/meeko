/**
 * Contrato serializable entre el runtime de desarrollo y los paneles de Meeko DevTools.
 *
 * Este archivo sólo contiene tipos. La extensión de Chrome consume una copia generada
 * en `tools/devtools-extension/types/protocol.d.ts`; `pnpm run devtools:types` la regenera
 * y `pnpm run devtools:check` falla si queda desactualizada.
 */

/** Versión del protocolo expuesta por el hook y por cada captura. Cambia sólo con incompatibilidades. */
export type DevtoolsProtocolVersion = 1;

/** Valores seguros para transportar una captura al panel de desarrollo. */
export type DevtoolsValue = null | boolean | number | string | DevtoolsValue[] | { [key: string]: DevtoolsValue };

/** Construcción de la plantilla o del script que lee una señal. */
export type DevtoolsReadKind = "text" | "attribute" | "computed" | "if" | "each" | "prop";

/** Ubicación de una expresión que lee una señal durante desarrollo. */
export interface DevtoolsReadSite {
  file: string;
  line: number;
  column: number;
  expression: string;
  kind: DevtoolsReadKind;
  /** Nombre de la prop del componente hijo cuando `kind` es `"prop"`. */
  name?: string;
}

/** Asignación `.value` del archivo `.meeko` que escribió una señal. */
export interface DevtoolsAssignmentSite {
  kind: "assignment";
  file: string;
  line: number;
  column: number;
  expression: string;
}

/** Escritura solicitada desde un panel mediante `setSignal`. */
export interface DevtoolsEditSite {
  kind: "devtools";
}

/** Origen conocido de la escritura que produjo un evento de señal. */
export type DevtoolsWriteSite = DevtoolsAssignmentSite | DevtoolsEditSite;

/** Estado serializable de una instancia hidratada. */
export interface DevtoolsInstance {
  id: string;
  componentId: string;
  name: string;
  file: string;
  props: DevtoolsValue;
  signals: Record<string, DevtoolsValue>;
  parentId: string | null;
  childIds: string[];
  status: "hydrated";
  breakpoint: boolean;
}

/** Tipos de evento de la línea de tiempo. */
export type DevtoolsEventKind = "mount" | "unmount" | "signal" | "breakpoint" | "select" | "hmr";

/** Cambio reciente del árbol de componentes o de una señal. */
export interface DevtoolsEvent {
  id: number;
  at: number;
  kind: DevtoolsEventKind;
  instanceId: string;
  detail?: string;
  /** Identidad del componente conservada incluso después del desmontaje. */
  componentName?: string;
  /** Archivo fuente `.meeko` proporcionado por la compilación de desarrollo. */
  file?: string;
  /** Valor posterior de una señal, copiado con los mismos límites que una captura. */
  value?: DevtoolsValue;
  /** Expresiones que dependían de la señal en esta instancia cuando cambió. No son el origen de la escritura. */
  reads?: DevtoolsReadSite[];
  /** Asignación instrumentada o edición desde un panel que escribió el nuevo valor, si se conoce. */
  write?: DevtoolsWriteSite;
}

/** Captura independiente de referencias DOM y de valores no serializables. */
export interface DevtoolsSnapshot {
  protocolVersion: DevtoolsProtocolVersion;
  instances: DevtoolsInstance[];
  events: DevtoolsEvent[];
  selectedId: string | null;
}

/** Resultado de una orden que puede rechazarse sin lanzar excepciones a través del puente. */
export type DevtoolsCommandResult = { ok: true } | { ok: false; error: string };

/** Interfaz pública que consume una extensión o un panel de desarrollo. */
export interface DevtoolsHook {
  readonly protocolVersion: DevtoolsProtocolVersion;
  snapshot(): DevtoolsSnapshot;
  subscribe(listener: () => void): () => void;
  select(id: string | null): void;
  highlight(id: string | null): void;
  setBreakpoint(id: string, enabled: boolean): void;
  /** Sustituye el valor de una señal editable de una instancia activa. Sólo existe en desarrollo. */
  setSignal(instanceId: string, name: string, value: DevtoolsValue): DevtoolsCommandResult;
}
