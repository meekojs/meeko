import { createServer } from "node:net";

/** Port `meeko dev` tries first when neither `PORT` nor `server.port` names one. */
export const defaultDevPort = 4173;
/** Ports `meeko dev` tries, from the default one up, before giving up. */
export const devPortAttempts = 20;
/** Host of Vite's HMR WebSocket server in `meeko dev`. */
export const devHmrHost = "127.0.0.1";

/**
 * Port of Vite's HMR WebSocket for an app on `port`: derived from it, so that concurrent
 * projects do not share Vite's default 24678.
 */
export function hmrPortFor(port: number): number {
  return ((port + 32767) % 65535) + 1;
}

/** Whether a TCP server could listen on `port` of `host` now. Other errors (an unknown host) reject. */
export function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") done(false);
      else fail(error);
    });
    probe.listen({ port, host, exclusive: true }, () => probe.close(() => done(true)));
  });
}

/** Ports `meeko dev` listens on; see {@link resolveDevPorts}. */
export interface DevPorts {
  /** Port of the HTTP server. */
  readonly port: number;
  /** Port of Vite's HMR WebSocket. */
  readonly hmrPort: number;
  /** The port `meeko dev` wanted when it had to take a later one, because that one was in use. */
  readonly busy?: number;
}

export interface DevPortRequest {
  /** Host of the HTTP server. */
  readonly host: string;
  /** Port named by `PORT` or `server.port`: used as is, even when in use, so listening fails clearly. */
  readonly port?: number;
  /** Port named by `MEEKO_HMR_PORT`: used as is. */
  readonly hmrPort?: number;
  /** First port tried without an explicit one. */
  readonly first?: number;
  /** Ports tried without an explicit one. */
  readonly attempts?: number;
  /** Probe; tests replace it. */
  readonly free?: (port: number, host: string) => Promise<boolean>;
}

/**
 * Chooses the ports of `meeko dev`. Without an explicit port it takes the first port from
 * {@link defaultDevPort} up whose HTTP port and derived HMR port are free, as Vite does; a
 * second `meeko dev` then starts beside the first instead of failing. An explicit port is kept,
 * and its derived HMR port too unless something else holds it, when the next free one is taken.
 * Fails with a Spanish message when no port in the range is free.
 */
export async function resolveDevPorts(request: DevPortRequest): Promise<DevPorts> {
  const free = request.free ?? isPortFree;
  const hmrFor = async (port: number): Promise<number | undefined> => {
    if (request.hmrPort !== undefined) return request.hmrPort;
    const derived = hmrPortFor(port);
    return await free(derived, devHmrHost) ? derived : undefined;
  };
  if (request.port !== undefined) {
    // Port 0 lets the system choose; the HMR port is then derived from 0.
    let hmrPort = await hmrFor(request.port);
    // The HMR port is an internal detail: another process holding it (often the other `meeko dev`
    // on this port, which listening then reports) does not stop the app.
    const derived = hmrPortFor(request.port);
    const last = Math.min(65535, derived + (request.attempts ?? devPortAttempts));
    for (let candidate = derived + 1; hmrPort === undefined && candidate <= last; candidate++) {
      if (await free(candidate, devHmrHost)) hmrPort = candidate;
    }
    return { port: request.port, hmrPort: hmrPort ?? hmrPortFor(request.port) };
  }
  const first = request.first ?? defaultDevPort;
  const attempts = request.attempts ?? devPortAttempts;
  for (let port = first; port < first + attempts && port <= 65535; port++) {
    if (!await free(port, request.host)) continue;
    const hmrPort = await hmrFor(port);
    if (hmrPort === undefined) continue;
    return port === first ? { port, hmrPort } : { port, hmrPort, busy: first };
  }
  throw Object.assign(
    new Error(`Los puertos ${first}–${first + attempts - 1} de ${request.host} ya están en uso; usa MEEKO_PORT=<puerto> o cierra otro meeko dev`),
    { code: "EADDRINUSE" },
  );
}

/** The error of a `meeko dev` whose HTTP port is taken, with the original error as its cause. */
export function devPortInUse(port: number, host: string, cause: unknown): Error {
  return Object.assign(
    new Error(`El puerto ${port} de ${host} ya está en uso; usa MEEKO_PORT=<otro puerto> o cierra el otro meeko dev`, { cause }),
    { code: "EADDRINUSE" },
  );
}
