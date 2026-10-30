/**
 * Addresses a local server prints when it starts listening. Only the presentation: the listening
 * address, the `url` of the adapters and the origins used by security checks are not derived from
 * here. Runtime-neutral: the caller passes the network interfaces of its platform.
 */

/**
 * Dirección de una interfaz de red, con la forma de `os.networkInterfaces()` de Node y de
 * `Deno.networkInterfaces()`.
 *
 * @example
 * ```ts
 * const address: NetworkInterfaceAddress = { address: "192.168.1.20", family: "IPv4", internal: false };
 * ```
 */
export interface NetworkInterfaceAddress {
  /** Dirección IPv4 o IPv6. */
  readonly address: string;
  /** `"IPv4"` o `"IPv6"`; Node 18.0–18.3 usaba `4` y `6`. */
  readonly family: string | number;
  /** Si es una interfaz interna (loopback). Deno no lo informa; las de loopback se descartan igualmente. */
  readonly internal?: boolean;
}

/**
 * Interfaces de red: el diccionario de `os.networkInterfaces()` o la lista de `Deno.networkInterfaces()`.
 *
 * @example
 * ```ts
 * import { networkInterfaces } from "node:os";
 *
 * const interfaces: NetworkInterfaces = networkInterfaces();
 * ```
 */
export type NetworkInterfaces =
  | Readonly<Record<string, readonly NetworkInterfaceAddress[] | undefined>>
  | readonly NetworkInterfaceAddress[];

/**
 * URL que muestra un servidor local al arrancar.
 *
 * @example
 * ```ts
 * const urls: ServerUrls = { local: "http://localhost:4173", network: ["http://192.168.1.20:4173"] };
 * ```
 */
export interface ServerUrls {
  /** URL para abrir desde este equipo, p. ej. `http://localhost:4173`. */
  readonly local: string;
  /** URL de las interfaces de red cuando el servidor escucha en todas (`0.0.0.0` o `::`); vacía en otro caso. */
  readonly network: readonly string[];
}

const loopbackNames = new Set(["localhost", "127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const wildcards = new Set(["0.0.0.0", "::", "::ffff:0.0.0.0"]);

function bare(host: string): string {
  const unbracketed = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return unbracketed.toLowerCase();
}

function authority(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

/**
 * Host que se muestra para una dirección de escucha: `localhost` para `127.0.0.1`, `::1` y las
 * direcciones comodín (`0.0.0.0`, `::`); cualquier otro host, tal cual y entre corchetes si es
 * IPv6. Otras direcciones `127.x` se muestran tal cual, porque `localhost` no las alcanza.
 *
 * @param host Dirección o nombre en el que escucha el servidor.
 * @returns El host listo para una URL.
 * @example
 * ```ts
 * displayHost("127.0.0.1"); // "localhost"
 * displayHost("0.0.0.0"); // "localhost"
 * displayHost("fd00::20"); // "[fd00::20]"
 * ```
 */
export function displayHost(host: string): string {
  const name = bare(host);
  return loopbackNames.has(name) || wildcards.has(name) ? "localhost" : authority(name);
}

function familyOf(entry: NetworkInterfaceAddress): 4 | 6 | undefined {
  if (entry.family === "IPv4" || entry.family === 4) return 4;
  if (entry.family === "IPv6" || entry.family === 6) return 6;
  return undefined;
}

function isLoopbackAddress(address: string, family: 4 | 6): boolean {
  return family === 4 ? address.startsWith("127.") : address === "::1";
}

/** IPv6 link-local addresses (`fe80::/10`) need a zone identifier that a browser URL cannot carry. */
function isLinkLocal(address: string): boolean {
  return /^fe[89ab]/i.test(address);
}

/**
 * URL que muestra un servidor que escucha en `host` y `port`. Con una dirección comodín añade las
 * direcciones de red: IPv4 con `0.0.0.0` e IPv4 e IPv6 con `::`, sin las de loopback ni las IPv6
 * de enlace local. Las interfaces sólo se leen en ese caso; si no se pueden leer (por ejemplo, sin
 * el permiso `sys` de Deno), la lista queda vacía.
 *
 * @param host Dirección en la que escucha el servidor.
 * @param port Puerto real en el que escucha.
 * @param interfaces Lee las interfaces de red; por defecto, ninguna.
 * @returns La URL local y las de red.
 * @example
 * ```ts
 * import { networkInterfaces } from "node:os";
 *
 * serverUrls("0.0.0.0", 4173, networkInterfaces);
 * // { local: "http://localhost:4173", network: ["http://192.168.1.20:4173"] }
 * ```
 */
export function serverUrls(host: string, port: number, interfaces?: () => NetworkInterfaces): ServerUrls {
  const local = `http://${displayHost(host)}:${port}`;
  const name = bare(host);
  if (!wildcards.has(name) || !interfaces) return { local, network: [] };
  let found: NetworkInterfaces;
  try { found = interfaces(); }
  catch { return { local, network: [] }; }
  const entries = Array.isArray(found) ? found as readonly NetworkInterfaceAddress[] : Object.values(found).flatMap((list) => list ?? []);
  const families = name === "::" ? new Set([4, 6]) : new Set([4]);
  const network = new Set<string>();
  for (const entry of entries) {
    const family = familyOf(entry);
    if (!family || !families.has(family) || entry.internal || isLoopbackAddress(entry.address, family)) continue;
    if (family === 6 && isLinkLocal(entry.address)) continue;
    network.add(`http://${authority(entry.address)}:${port}`);
  }
  return { local, network: [...network] };
}

/**
 * Mensaje que imprimen `meeko dev`, `meeko start`, `meeko preview` y las salidas de los
 * adaptadores al empezar a escuchar. La primera línea es siempre la URL local sola, para que los
 * scripts puedan leerla; con una dirección comodín siguen las de red, una por línea con `Red:`.
 *
 * @param host Dirección en la que escucha el servidor.
 * @param port Puerto real en el que escucha.
 * @param interfaces Lee las interfaces de red; por defecto, ninguna.
 * @returns Las líneas, terminadas en salto de línea.
 * @example
 * ```ts
 * import { networkInterfaces } from "node:os";
 *
 * process.stdout.write(listeningMessage("0.0.0.0", 4173, networkInterfaces));
 * // http://localhost:4173
 * // Red: http://192.168.1.20:4173
 * ```
 */
export function listeningMessage(host: string, port: number, interfaces?: () => NetworkInterfaces): string {
  const urls = serverUrls(host, port, interfaces);
  return [urls.local, ...urls.network.map((url) => `Red: ${url}`)].map((line) => `${line}\n`).join("");
}
