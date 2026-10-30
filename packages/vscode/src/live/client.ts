import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import type { ClientRequest } from "node:http";
import { SseParser, loopbackBridgeUrl } from "./model.js";
import type { EditorBridgeDescriptor, EditorBridgeEvent, EditorCommandResult, EditorLiveSignal } from "./model.js";

/** `true` si el proceso existe; un error de permisos también indica que existe. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Cambios de una conexión: señales nuevas o actualizadas y señales que ya no existen. */
export interface LiveChange {
  changed: string[];
  removed: string[];
  /** `true` cuando la conexión sustituyó todo su estado (conexión nueva o cierre). */
  reset: boolean;
}

export interface BridgeConnectionOptions {
  /** Ruta de un descriptor `.meeko/dev/editor-bridge-<puerto>.json`. */
  descriptor: string;
  onState(connected: boolean): void;
  onChange(change: LiveChange): void;
  log?(message: string): void;
  /** Esperas entre reintentos mientras el descriptor exista; por defecto de 1 a 10 s. */
  retryDelays?: readonly number[];
}

/**
 * Conexión con el puente de un `meeko dev`. Lee el descriptor, se suscribe por SSE con el
 * token de la sesión y reintenta mientras el descriptor exista; `reload()` reconecta al
 * instante cuando el descriptor cambia porque `meeko dev` se reinició.
 */
export class BridgeConnection {
  readonly signals = new Map<string, EditorLiveSignal>();
  private current: { url: URL; token: string; request: ClientRequest } | undefined;
  private connected = false;
  private disposed = false;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  /** PID de `meeko dev` según el descriptor; si ya no existe, no se reintenta hasta que el descriptor cambie. */
  private pid: number | undefined;

  constructor(private readonly options: BridgeConnectionOptions) {}

  get isConnected(): boolean {
    return this.connected;
  }

  get url(): string | undefined {
    return this.current?.url.href;
  }

  /** Conecta, o reconecta tras un cambio del descriptor. */
  reload(): void {
    if (this.disposed) return;
    this.attempt = 0;
    void this.connect();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
  }

  private stop(): void {
    this.generation++;
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    this.current?.request.destroy();
    this.current = undefined;
    this.setConnected(false);
    if (this.signals.size) {
      const removed = [...this.signals.keys()];
      this.signals.clear();
      this.options.onChange({ changed: [], removed, reset: true });
    }
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    this.options.onState(connected);
  }

  private schedule(generation: number): void {
    if (this.disposed || generation !== this.generation) return;
    if (this.pid !== undefined && !isAlive(this.pid)) {
      this.options.log?.(`Meeko live: meeko dev (pid ${this.pid}) ya no se ejecuta; se espera a que vuelva a arrancar`);
      return;
    }
    const delays = this.options.retryDelays ?? [1000, 2000, 5000, 10_000];
    const delay = delays[Math.min(this.attempt, delays.length - 1)] ?? 10_000;
    this.attempt++;
    this.retry = setTimeout(() => { this.retry = undefined; void this.connect(); }, delay);
  }

  private async connect(): Promise<void> {
    this.stop();
    const generation = this.generation;
    let descriptor: Partial<EditorBridgeDescriptor>;
    try {
      descriptor = JSON.parse(await readFile(this.options.descriptor, "utf8")) as Partial<EditorBridgeDescriptor>;
    } catch (error) {
      this.options.log?.(`Meeko live: no se pudo leer ${this.options.descriptor}: ${error instanceof Error ? error.message : String(error)}`);
      // A descriptor being written is read again on its change event; a missing one is dropped by the watcher.
      this.schedule(generation);
      return;
    }
    if (generation !== this.generation || this.disposed) return;
    const url = loopbackBridgeUrl(descriptor.url);
    if (descriptor.protocol !== 1 || !url || typeof descriptor.token !== "string" || !descriptor.token) {
      this.options.log?.(`Meeko live: descriptor no válido en ${this.options.descriptor}; sólo se aceptan URLs de loopback y el protocolo 1`);
      return;
    }
    const token = descriptor.token;
    this.pid = typeof descriptor.pid === "number" && Number.isInteger(descriptor.pid) && descriptor.pid > 0 ? descriptor.pid : undefined;
    const parser = new SseParser((event, data) => {
      if (generation !== this.generation) return;
      let parsed: EditorBridgeEvent;
      try { parsed = JSON.parse(data) as EditorBridgeEvent; } catch { return; }
      if (parsed.type !== event) return;
      this.receive(parsed);
    });
    const request = httpRequest(new URL(`${url.href.replace(/\/$/, "")}/events`), {
      headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
    }, (response) => {
      if (response.statusCode !== 200) {
        this.options.log?.(`Meeko live: ${url.href} respondió ${response.statusCode}`);
        response.resume();
        this.schedule(generation);
        return;
      }
      this.attempt = 0;
      this.setConnected(true);
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => parser.push(chunk));
      response.on("end", () => this.lost(generation));
      response.on("error", () => this.lost(generation));
    });
    request.on("error", (error) => {
      if (generation !== this.generation) return;
      this.options.log?.(`Meeko live: sin conexión con ${url.href}: ${error.message}`);
      this.lost(generation);
    });
    request.end();
    this.current = { url, token, request };
  }

  private lost(generation: number): void {
    if (generation !== this.generation) return;
    this.current?.request.destroy();
    this.current = undefined;
    this.setConnected(false);
    if (this.signals.size) {
      const removed = [...this.signals.keys()];
      this.signals.clear();
      this.options.onChange({ changed: [], removed, reset: true });
    }
    this.schedule(generation);
  }

  private receive(event: EditorBridgeEvent): void {
    if (event.type === "snapshot") {
      const removed = [...this.signals.keys()].filter((id) => !event.signals.some((signal) => signal.id === id));
      this.signals.clear();
      for (const signal of event.signals) this.signals.set(signal.id, signal);
      this.options.onChange({ changed: event.signals.map((signal) => signal.id), removed, reset: true });
    } else if (event.type === "update") {
      for (const id of event.removed) this.signals.delete(id);
      const changed: string[] = [];
      for (const signal of event.signals) {
        const previous = this.signals.get(signal.id);
        this.signals.set(signal.id, signal);
        if (!previous || previous.json !== signal.json) changed.push(signal.id);
      }
      this.options.onChange({ changed, removed: event.removed, reset: false });
    }
  }

  /** Envía `setSignal` al navegador que tiene montada la señal. */
  async setSignal(id: string, value: unknown): Promise<EditorCommandResult> {
    const current = this.current;
    if (!current || !this.connected) return { ok: false, error: "Meeko live no está conectado" };
    const body = JSON.stringify({ type: "setSignal", id, value });
    return new Promise<EditorCommandResult>((done) => {
      const request = httpRequest(new URL(`${current.url.href.replace(/\/$/, "")}/command`), {
        method: "POST",
        headers: { authorization: `Bearer ${current.token}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      }, (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { text += chunk; });
        response.on("end", () => {
          try {
            const result = JSON.parse(text) as EditorCommandResult;
            done(result.ok === true ? { ok: true } : { ok: false, error: typeof result.error === "string" ? result.error : `HTTP ${response.statusCode}` });
          } catch {
            done({ ok: false, error: `HTTP ${response.statusCode}` });
          }
        });
      });
      request.on("error", (error) => done({ ok: false, error: error.message }));
      request.setTimeout(10_000, () => request.destroy(new Error("Tiempo de espera agotado")));
      request.end(body);
    });
  }
}
