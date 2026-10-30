/**
 * Contrato del puente de valores en vivo entre el navegador, `meeko dev` y un editor local.
 *
 * Este archivo sólo contiene tipos. Lo comparten el runtime de desarrollo del navegador
 * (`src/devtools-live.ts`), el servidor de desarrollo (`src/framework/editor-bridge.ts`)
 * y la extensión de VS Code (`packages/vscode/src/live` en el repositorio).
 */
import type { DevtoolsCommandResult, DevtoolsValue } from "./devtools-protocol.js";

/** Versión del protocolo del puente. Cambia sólo con incompatibilidades. */
export type EditorBridgeProtocolVersion = 1;

/**
 * Contenido de `.meeko/dev/editor-bridge-<puerto>.json`, que cada `meeko dev` escribe al escuchar
 * en loopback y borra al cerrarse. El token cambia en cada sesión. Con varios `meeko dev` del mismo
 * proyecto hay un descriptor por servidor y el editor se conecta a todos.
 */
export interface EditorBridgeDescriptor {
  protocol: EditorBridgeProtocolVersion;
  /** Base HTTP del puente, siempre en loopback: `http://127.0.0.1:4173/__meeko/editor-bridge`. */
  url: string;
  token: string;
  pid: number;
  /** Raíz absoluta del proyecto que sirve `meeko dev`. */
  root: string;
  startedAt: string;
}

/**
 * Contenido de `.meeko/dev/server.json`, el registro del `meeko dev` que sirve el proyecto mientras
 * se ejecuta. Desde `1.7.1`, `editorBridge: false` indica que ese servidor no publica valores en
 * vivo (no hay descriptor `editor-bridge-<puerto>.json`) y `editorBridgeReason` explica por qué,
 * como `MEEKO_EDITOR_BRIDGE=0`; el editor lo muestra en lugar de esperar al descriptor.
 */
export interface DevelopmentServerRecord {
  pid: number;
  startedAt: string;
  editorBridge?: false;
  editorBridgeReason?: string;
}

/** Valor actual de una señal de una instancia montada en una pestaña del navegador. */
export interface EditorLiveSignal {
  /** Identidad estable mientras viva la instancia: `pestaña/instancia/nombre`. */
  id: string;
  tab: string;
  instanceId: string;
  component: string;
  name: string;
  /** Ruta absoluta del `.meeko` con barras `/`, como la compila Vite. */
  file: string;
  /** Declaración de la señal en `file`; línea y columna empiezan en 1. */
  line?: number;
  column?: number;
  /** JSON del valor copiado con los límites de DevTools; si `truncated`, está recortado y no es JSON válido. */
  json: string;
  truncated: boolean;
  /**
   * Presente si esta señal es la misma instancia de signal que otra de la pestaña, p. ej. el
   * modelo que un hijo recibe con `defineModel`. Editarla equivale a editar la principal.
   */
  alias?: EditorLiveAlias;
}

/** Señal principal de un alias: la que declara el signal en lugar de recibirlo prestado. */
export interface EditorLiveAlias {
  /** ID de la señal principal, en la misma pestaña. */
  id: string;
  instanceId: string;
  component: string;
  name: string;
  file: string;
  line?: number;
  column?: number;
}

/**
 * Eventos SSE de `GET <url>/events`; el nombre del evento SSE coincide con `type`. Si no había
 * otro editor conectado, `snapshot` espera hasta unos 300 ms el estado de las pestañas abiertas.
 */
export type EditorBridgeEvent =
  | { type: "hello"; protocol: EditorBridgeProtocolVersion; session: string; root: string }
  | { type: "snapshot"; signals: EditorLiveSignal[] }
  | { type: "update"; signals: EditorLiveSignal[]; removed: string[] };

/** Cuerpo JSON de `POST <url>/command`. */
export interface EditorSetSignalCommand {
  type: "setSignal";
  id: string;
  value: DevtoolsValue;
}

/** Respuesta JSON de `POST <url>/command`. */
export type EditorCommandResult = DevtoolsCommandResult;

/** Señal enviada por el navegador; el servidor le añade la pestaña y el ID. */
export interface LiveBrowserSignal {
  instanceId: string;
  component: string;
  file: string;
  name: string;
  line?: number;
  column?: number;
  json: string;
  truncated: boolean;
  /** Señal principal si esta es la misma instancia de signal; el servidor le añade el ID. */
  alias?: Omit<EditorLiveAlias, "id">;
}

/** Evento `meeko:live:update` del navegador al servidor de desarrollo. */
export interface LiveBrowserUpdate {
  /** La pestaña reenvía todas sus instancias; el servidor descarta lo anterior de ella. */
  reset: boolean;
  /** Instancias desmontadas o reemplazadas por HMR; sus señales se quitan antes de aplicar `signals`. */
  removed: string[];
  signals: LiveBrowserSignal[];
}

/** Evento `meeko:live:result` del navegador al servidor de desarrollo. */
export interface LiveBrowserResult {
  request: number;
  result: DevtoolsCommandResult;
}

/** Contenido de un evento `meeko:live` del servidor de desarrollo al navegador. */
export type LiveServerBody =
  | { type: "state"; active: boolean }
  | { type: "setSignal"; request: number; instanceId: string; name: string; value: DevtoolsValue };

/** Evento `meeko:live`; `seq` crece en cada sesión y el navegador procesa cada mensaje una vez. */
export type LiveServerMessage = { seq: number; session: string } & LiveServerBody;
