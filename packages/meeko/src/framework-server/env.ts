// Environment variables that Meeko itself reads. Since 1.2 each one is named `MEEKO_<NAME>`.
// `HOST` and `PUBLIC_ORIGIN` keep working through 1.x with a one-time warning and go away in 2.0;
// `PORT` stays a permanent fallback because hosting platforms inject it. Portable: the values
// come from `process.env`, `Deno.env.toObject()` or the Worker bindings.

/** Variables with a name from before `MEEKO_`. */
export type MeekoEnvName = "HOST" | "PORT" | "PUBLIC_ORIGIN";

const permanentFallbacks: ReadonlySet<MeekoEnvName> = new Set(["PORT"]);
const warned = new Set<string>();

/** Writes a deprecation warning once per process. */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  try { console.warn(message); }
  catch { /* A broken console cannot stop the server. */ }
}

/** Forgets the warnings already written; for tests. */
export function resetEnvWarnings(): void { warned.clear(); }

/** A nonempty string variable of `env`, which may be `process.env` or the Worker bindings. */
export function envString(env: unknown, name: string): string | undefined {
  if (!env || typeof env !== "object") return undefined;
  let value: unknown;
  try { value = (env as Record<string, unknown>)[name]; }
  catch { return undefined; }
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Reads `MEEKO_<name>`, or the name from before 1.2. `PORT` is a permanent fallback; `HOST` and
 * `PUBLIC_ORIGIN` still work in 1.x and warn once, naming the new variable.
 */
export function meekoEnv(env: unknown, name: MeekoEnvName): string | undefined {
  const value = envString(env, `MEEKO_${name}`);
  if (value !== undefined) return value;
  const legacy = envString(env, name);
  if (legacy !== undefined && !permanentFallbacks.has(name)) {
    warnOnce(`env:${name}`, `[meeko] La variable ${name} está obsoleta desde Meeko 1.2; usa MEEKO_${name}. ${name} dejará de leerse en Meeko 2.0.`);
  }
  return legacy;
}

const durationUnits: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * Milliseconds of a duration such as `"500ms"`, `"30s"`, `"5m"`, `"12h"` or `"7d"`, or of a
 * positive integer of milliseconds.
 * @throws {RangeError} With `label` when the value is not a positive duration.
 */
export function parseDuration(value: unknown, label: string): number {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value > 0) return value;
  } else if (typeof value === "string") {
    const match = /^\s*(\d+)\s*(ms|s|m|h|d)\s*$/.exec(value);
    if (match) {
      const result = Number(match[1]) * durationUnits[match[2]!]!;
      if (Number.isSafeInteger(result) && result > 0) return result;
    }
  }
  throw new RangeError(`${label} must be a positive duration such as "30s", "5m", "12h" or "7d"`);
}

/** How many proxies in front of the server may add `X-Forwarded-For`; `true` trusts all of them. */
export type TrustProxy = boolean | number;

const trustCache = new WeakMap<object, TrustProxy>();

/**
 * `MEEKO_TRUST_PROXY`: unset, `false` or `0` trusts no proxy; a positive integer is the number of
 * proxies whose `X-Forwarded-For` entries are trusted; `true` trusts every entry.
 * @throws {TypeError} When the value is anything else.
 */
export function trustProxyOf(env: unknown): TrustProxy {
  if (env && typeof env === "object" && trustCache.has(env)) return trustCache.get(env)!;
  const raw = envString(env, "MEEKO_TRUST_PROXY");
  let trust: TrustProxy;
  if (raw === undefined || raw === "false" || raw === "0") trust = false;
  else if (raw === "true") trust = true;
  else if (/^[1-9]\d{0,1}$/.test(raw)) trust = Number(raw);
  else throw new TypeError(`MEEKO_TRUST_PROXY must be true, false or the number of trusted proxies (1-99), not ${JSON.stringify(raw)}`);
  // process.env is a live object: only frozen records such as Worker bindings are cached.
  if (env && typeof env === "object" && Object.isFrozen(env)) trustCache.set(env, trust);
  return trust;
}

/** Addresses that the host saw on the connection, attached by each adapter. */
const socketAddresses = new WeakMap<Request, string>();

/** Records the connection address of `request`; adapters call it before `app.fetch`. */
export function setSocketAddress(request: Request, address: string | undefined): Request {
  const normalized = address === undefined ? undefined : normalizeAddress(address);
  if (normalized !== undefined) socketAddresses.set(request, normalized);
  return request;
}

/**
 * Carries the connection address of `from` over to a copy of the request, such as a rebased one or
 * the one a server middleware passes to `next()`. An address already recorded on `to` is kept.
 */
export function copySocketAddress(from: Request, to: Request): Request {
  const address = socketAddresses.get(from);
  if (address !== undefined && from !== to && !socketAddresses.has(to)) socketAddresses.set(to, address);
  return to;
}

/** The connection address recorded by the adapter, if any. */
export function socketAddressOf(request: Request): string | undefined { return socketAddresses.get(request); }

/**
 * An IPv4 or IPv6 address in a stable form: IPv4-mapped IPv6 becomes IPv4, IPv6 is lowercase and
 * loses its zone and brackets. Anything that is not an address yields `undefined`.
 */
export function normalizeAddress(value: string): string | undefined {
  let address = value.trim();
  if (address.startsWith("[")) {
    const end = address.indexOf("]");
    if (end < 0) return undefined;
    address = address.slice(1, end);
  }
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  address = address.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped) address = mapped[1]!;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return address.split(".").every((part) => Number(part) <= 255) ? address : undefined;
  return expandIpv6(address) === undefined ? undefined : address;
}

/** The eight 16-bit groups of an IPv6 address, or `undefined`. */
export function expandIpv6(address: string): number[] | undefined {
  if (!/^[0-9a-f:.]+$/.test(address) || address.length > 45) return undefined;
  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const groups = (part: string): number[] | undefined => {
    if (part === "") return [];
    const result: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return undefined;
      result.push(parseInt(group, 16));
    }
    return result;
  };
  const head = groups(halves[0]!);
  const tail = halves.length === 2 ? groups(halves[1]!) : [];
  if (!head || !tail) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - tail.length;
  return missing >= 1 ? [...head, ...new Array<number>(missing).fill(0), ...tail] : undefined;
}

/**
 * The address of an `X-Forwarded-For` entry, which some proxies (Azure Application Gateway) write
 * with a port: `1.2.3.4:5678` or `[2001:db8::1]:5678`. Anything else that is not an address yields
 * `undefined`.
 */
export function forwardedAddress(entry: string): string | undefined {
  const value = entry.trim();
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(value);
  if (ipv4WithPort) return normalizeAddress(ipv4WithPort[1]!);
  if (value.startsWith("[")) {
    // `[address]` with an optional `:port`, and nothing else after the bracket.
    const end = value.indexOf("]");
    if (end < 0 || !/^(?::\d{1,5})?$/.test(value.slice(end + 1))) return undefined;
  }
  return normalizeAddress(value);
}

/**
 * The client address of a request: the connection address, or with `MEEKO_TRUST_PROXY` the
 * `X-Forwarded-For` entry added by the outermost trusted proxy, without its port. `X-Forwarded-For`
 * is never read without that variable, because any client can send it. An entry that is not an
 * address falls back to the connection address, never to an unknown client.
 */
export function clientAddressOf(request: Request, env: unknown): string | undefined {
  const socket = socketAddresses.get(request);
  const trust = trustProxyOf(env);
  if (trust === false) return socket;
  const header = request.headers.get("x-forwarded-for");
  const entries = header ? header.split(",").map((entry) => entry.trim()).filter(Boolean) : [];
  if (!entries.length) return socket;
  // With n trusted proxies, the nth entry from the right was written by the outermost one.
  const chosen = trust === true ? entries[0]! : entries[Math.max(0, entries.length - trust)]!;
  return forwardedAddress(chosen) ?? socket;
}

/** The bucket of an address for rate limits: IPv4 as is, IPv6 by its /64 network. */
export function addressBucket(address: string): string {
  const groups = address.includes(":") ? expandIpv6(address) : undefined;
  if (!groups) return address;
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}
