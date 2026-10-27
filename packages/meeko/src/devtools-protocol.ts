/**
 * Contrato serializable entre el runtime de desarrollo y los paneles de Meeko DevTools.
 *
 * Este archivo sólo contiene tipos. La extensión de Chrome consume una copia generada
 * en `packages/devtools/types/protocol.d.ts` del repositorio; `pnpm run devtools:types` la regenera
 * y `pnpm run devtools:check` falla si queda desactualizada.
 */

/**
 * Versión del protocolo expuesta por el hook y por cada captura. Cambia sólo con incompatibilidades.
 *
 * @example
 * ```ts
 * import type { DevtoolsProtocolVersion } from "@meekojs/meeko";
 *
 * const supported: DevtoolsProtocolVersion = 1;
 * const hook = window.__MEEKO_DEVTOOLS__;
 * if (hook && hook.protocolVersion !== supported) console.warn("Versión de Meeko DevTools no soportada");
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#protocolo
 */
export type DevtoolsProtocolVersion = 1;

/**
 * Valor serializable que transporta una captura al panel: los valores no representables en JSON
 * llegan ya convertidos.
 *
 * @example
 * ```ts
 * import type { DevtoolsValue } from "@meekojs/meeko";
 *
 * const props: DevtoolsValue = { title: "Hola", tags: ["a", "b"], count: 2 };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#protocolo
 */
export type DevtoolsValue = null | boolean | number | string | DevtoolsValue[] | { [key: string]: DevtoolsValue };

/**
 * Construcción de la plantilla o del script que lee una señal. Puede ganar miembros en un minor.
 *
 * @example
 * ```ts
 * import type { DevtoolsReadKind } from "@meekojs/meeko";
 *
 * const labels: Partial<Record<DevtoolsReadKind, string>> = { text: "Texto", attribute: "Atributo", if: "Condición" };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#protocolo
 */
export type DevtoolsReadKind = "text" | "attribute" | "computed" | "if" | "each" | "prop";

/**
 * Ubicación de una expresión que lee una señal durante desarrollo; línea y columna empiezan en 1.
 *
 * @example
 * ```ts
 * import type { DevtoolsReadSite } from "@meekojs/meeko";
 *
 * const where = (site: DevtoolsReadSite): string => `${site.file}:${site.line}:${site.column} ${site.expression}`;
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#protocolo
 */
export interface DevtoolsReadSite {
  /** Archivo `.meeko`. */
  file: string;
  /** Línea, desde 1. */
  line: number;
  /** Columna, desde 1. */
  column: number;
  /** Texto de la expresión. */
  expression: string;
  /** Construcción que lee la señal. */
  kind: DevtoolsReadKind;
  /** Nombre de la prop del componente hijo cuando `kind` es `"prop"`. */
  name?: string;
}

/**
 * Asignación `.value` del archivo `.meeko` que escribió una señal.
 *
 * @example
 * ```ts
 * import type { DevtoolsAssignmentSite } from "@meekojs/meeko";
 *
 * const site: DevtoolsAssignmentSite = { kind: "assignment", file: "app/components/Counter.meeko", line: 4, column: 3, expression: "count.value++" };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#protocolo
 */
export interface DevtoolsAssignmentSite {
  /** Discriminante: una asignación del código del componente. */
  kind: "assignment";
  /** Archivo `.meeko`. */
  file: string;
  /** Línea donde empieza la asignación, desde 1. */
  line: number;
  /** Columna donde empieza la asignación, desde 1. */
  column: number;
  /** Texto de la asignación, compactado y recortado a 200 caracteres. */
  expression: string;
}

/**
 * Escritura solicitada desde un panel mediante `setSignal`.
 *
 * @example
 * ```ts
 * import type { DevtoolsEditSite } from "@meekojs/meeko";
 *
 * const fromPanel: DevtoolsEditSite = { kind: "devtools" };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#protocolo
 */
export interface DevtoolsEditSite {
  /** Discriminante: una edición desde un panel con `setSignal`. */
  kind: "devtools";
}

/**
 * Origen conocido de la escritura que produjo un evento de señal.
 *
 * @example
 * ```ts
 * import type { DevtoolsWriteSite } from "@meekojs/meeko";
 *
 * const describe = (write: DevtoolsWriteSite): string =>
 *   write.kind === "devtools" ? "editado desde el panel" : `${write.file}:${write.line} ${write.expression}`;
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#protocolo
 */
export type DevtoolsWriteSite = DevtoolsAssignmentSite | DevtoolsEditSite;

/**
 * Declaración de una señal en su archivo `.meeko`; línea y columna empiezan en 1.
 *
 * @example
 * ```ts
 * import type { DevtoolsSignalSite } from "@meekojs/meeko";
 *
 * const site: DevtoolsSignalSite = { file: "app/components/Counter.meeko", line: 3, column: 7 };
 * ```
 * @since 1.1.0
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#protocolo
 */
export interface DevtoolsSignalSite {
  /** Archivo `.meeko` que declara la señal. */
  file: string;
  /** Línea de la declaración, desde 1. */
  line: number;
  /** Columna de la declaración, desde 1. */
  column: number;
}

/**
 * Estado serializable de una instancia hidratada: props, señales y posición en el árbol.
 *
 * @example
 * ```ts
 * const snapshot = window.__MEEKO_DEVTOOLS__?.snapshot();
 * for (const instance of snapshot?.instances ?? []) {
 *   console.log(instance.name, instance.file, instance.signals);
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#protocolo
 */
export interface DevtoolsInstance {
  /** ID de la instancia (`meeko-N`), estable mientras vive. */
  id: string;
  /** Identificador del componente compilado. */
  componentId: string;
  /** Nombre del componente. */
  name: string;
  /** Archivo `.meeko` de origen. */
  file: string;
  /** Copia serializable de las props. */
  props: DevtoolsValue;
  /** Valores de las señales editables por nombre. */
  signals: Record<string, DevtoolsValue>;
  /**
   * Declaración de cada señal de `signals`, cuando la compilación de desarrollo la conoce.
   * @since 1.1.0
   */
  signalSites?: Record<string, DevtoolsSignalSite>;
  /** Instancia padre, o `null` en una raíz. */
  parentId: string | null;
  /** Instancias hijas en orden. */
  childIds: string[];
  /** Estado de la instancia. */
  status: "hydrated";
  /** Si los cambios de sus señales detienen el depurador. */
  breakpoint: boolean;
}

/**
 * Tipos de evento de la línea de tiempo. Puede ganar miembros en un minor: un `switch` exhaustivo
 * necesita rama por defecto.
 *
 * @example
 * ```ts
 * import type { DevtoolsEventKind } from "@meekojs/meeko";
 *
 * const isLifecycle = (kind: DevtoolsEventKind): boolean => kind === "mount" || kind === "unmount";
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#protocolo
 */
export type DevtoolsEventKind = "mount" | "unmount" | "signal" | "breakpoint" | "select" | "hmr";

/**
 * Cambio reciente del árbol de componentes o de una señal en la línea de tiempo.
 *
 * @example
 * ```ts
 * const events = window.__MEEKO_DEVTOOLS__?.snapshot().events ?? [];
 * for (const event of events.filter((item) => item.kind === "signal")) {
 *   console.log(event.componentName, event.detail, event.value, event.write?.kind);
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#protocolo
 */
export interface DevtoolsEvent {
  /** Número de secuencia del evento. */
  id: number;
  /** Momento del evento, en milisegundos desde la época. */
  at: number;
  /** Tipo de evento. */
  kind: DevtoolsEventKind;
  /** Instancia afectada. */
  instanceId: string;
  /** Detalle legible, como el nombre de la señal. */
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

/**
 * Captura del estado de DevTools, independiente de referencias DOM y de valores no serializables.
 *
 * @example
 * ```ts
 * import type { DevtoolsSnapshot } from "@meekojs/meeko";
 *
 * const snapshot: DevtoolsSnapshot | undefined = window.__MEEKO_DEVTOOLS__?.snapshot();
 * const selected = snapshot?.instances.find((instance) => instance.id === snapshot.selectedId);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#protocolo
 */
export interface DevtoolsSnapshot {
  /** Versión del protocolo que implementa el runtime. */
  protocolVersion: DevtoolsProtocolVersion;
  /** Instancias hidratadas activas; cada una enlaza a su padre y a sus hijas por ID. */
  instances: DevtoolsInstance[];
  /** Copia de los eventos recientes de la línea de tiempo, del más antiguo al más nuevo; guarda hasta 100. */
  events: DevtoolsEvent[];
  /** Instancia seleccionada con `select`, o `null` si no hay ninguna. */
  selectedId: string | null;
}

/**
 * Resultado de una orden que puede rechazarse sin lanzar excepciones a través del puente.
 *
 * @example
 * ```ts
 * const result = window.__MEEKO_DEVTOOLS__?.setSignal("meeko-1", "count", 5);
 * if (result && !result.ok) console.warn(result.error);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#protocolo
 */
export type DevtoolsCommandResult =
  | {
    /** La orden se aplicó. */
    ok: true;
  }
  | {
    /** La orden se rechazó o falló durante su aplicación. */
    ok: false;
    /** Motivo legible del fallo. */
    error: string;
  };

/**
 * Interfaz pública que consume una extensión o un panel de desarrollo, disponible en desarrollo
 * como `window.__MEEKO_DEVTOOLS__`.
 *
 * @example
 * ```ts
 * const hook = window.__MEEKO_DEVTOOLS__;
 * const stop = hook?.subscribe(() => {
 *   const { instances } = hook.snapshot();
 *   console.log(`${instances.length} instancias`);
 * });
 * hook?.highlight(null);
 * stop?.();
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#protocolo
 */
export interface DevtoolsHook {
  /** Versión del protocolo que implementa el runtime. */
  readonly protocolVersion: DevtoolsProtocolVersion;
  /** Devuelve una captura nueva del estado. */
  snapshot(): DevtoolsSnapshot;
  /** Avisa de cada cambio; devuelve la función que cancela la suscripción. */
  subscribe(listener: () => void): () => void;
  /** Selecciona una instancia, o ninguna con `null`. */
  select(id: string | null): void;
  /** Resalta en la página los nodos de una instancia, o ninguno con `null`. */
  highlight(id: string | null): void;
  /** Activa o desactiva una pausa (`debugger`) en los cambios de señal de una instancia. */
  setBreakpoint(id: string, enabled: boolean): void;
  /** Sustituye el valor de una señal editable de una instancia activa. Sólo existe en desarrollo. */
  setSignal(instanceId: string, name: string, value: DevtoolsValue): DevtoolsCommandResult;
}
