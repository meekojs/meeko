import { encodeBase64Url } from "./base64url.js";

/**
 * Política `Content-Security-Policy` por directiva: cada clave es el nombre de una directiva
 * (`"script-src"`) y su valor, la lista de fuentes tal como se escriben en la cabecera
 * (`"'self'"`, `"https://cdn.example"`). Una lista vacía escribe la directiva sin fuentes, como
 * `upgrade-insecure-requests`.
 *
 * @since 1.3.0
 * @example
 * ```ts
 * import type { ContentSecurityPolicy } from "@meekojs/meeko/server";
 *
 * const policy: ContentSecurityPolicy = {
 *   "default-src": ["'self'"],
 *   "script-src": ["'self'"],
 *   "object-src": ["'none'"],
 *   "base-uri": ["'none'"],
 * };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#csp-con-hashes
 */
export type ContentSecurityPolicy = Readonly<Record<string, readonly string[]>>;

const directiveName = /^[a-z][a-z0-9-]*$/;
/** A source is one token: no whitespace, no `;` (directive separator) or `,` (policy separator). */
const sourceToken = /^[^\s;,]+$/;
/** `'sha256-<base64>'`, `'sha384-…'` or `'sha512-…'`. */
const hashSource = /^'sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}'$/;

/**
 * Construye el valor de la cabecera `Content-Security-Policy` a partir de una política y de los
 * hashes de los scripts en línea que ejecutan las páginas (como los de
 * `PrerenderIndex.pages[ruta].scriptHashes`). Los hashes se añaden a `script-src`, sin repetir
 * fuentes; si la política no tiene `script-src`, se crea con las fuentes de `default-src`, para
 * que los hashes no restrinjan más que la política. Sin `script-src` ni `default-src`, los
 * scripts ya están permitidos y los hashes no se añaden.
 *
 * Con hashes en `script-src`, el navegador ignora `'unsafe-inline'` de esa directiva. Desde `1.7`,
 * si la política tiene `script-src-elem`, los hashes van a esa directiva, que es la que rige los
 * elementos `<script>`.
 *
 * Desde `1.4`, `styleHashes` (como `PrerenderIndex.pages[ruta].styleHashes`) permite igual los
 * `<style>` en línea, como el del tema de `<MeekoThemeToggle>` y los de los componentes: van a
 * `style-src-elem` si la política la tiene, si no a `style-src`, o a una copia de `default-src`.
 * Si esa directiva ya admite `'unsafe-inline'` no se añaden, porque con un hash el navegador
 * ignoraría `'unsafe-inline'` y bloquearía los atributos `style="…"`, que ningún hash permite.
 *
 * @param policy Directivas y fuentes de la política.
 * @param scriptHashes Fuentes `'sha256-…'` (o `sha384`/`sha512`) de los scripts en línea.
 * @param styleHashes Fuentes `'sha256-…'` (o `sha384`/`sha512`) de los `<style>` en línea; desde `1.4`.
 * @returns El valor de la cabecera, con las directivas en el orden de `policy`.
 * @throws {TypeError} Si un nombre de directiva, una fuente o un hash no son válidos.
 * @since 1.3.0
 * @example
 * ```ts
 * import { contentSecurityPolicy } from "@meekojs/meeko/server";
 *
 * const header = contentSecurityPolicy(
 *   { "default-src": ["'self'"], "object-src": ["'none'"] },
 *   ["'sha256-B2yPHKaXnvFWtRChIbabYmUBFZdVfKKXHbWtWidDVF8='"],
 * );
 * // "default-src 'self'; object-src 'none'; script-src 'self' 'sha256-B2yP…'"
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#csp-con-hashes
 */
export function contentSecurityPolicy(policy: ContentSecurityPolicy, scriptHashes: readonly string[] = [], styleHashes: readonly string[] = []): string {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new TypeError("contentSecurityPolicy: the policy must be an object of directives");
  for (const hash of scriptHashes) {
    if (typeof hash !== "string" || !hashSource.test(hash)) throw new TypeError(`contentSecurityPolicy: invalid script hash ${JSON.stringify(hash)}`);
  }
  for (const hash of styleHashes) {
    if (typeof hash !== "string" || !hashSource.test(hash)) throw new TypeError(`contentSecurityPolicy: invalid style hash ${JSON.stringify(hash)}`);
  }
  const directives = new Map<string, string[]>();
  for (const [name, sources] of Object.entries(policy)) {
    if (!directiveName.test(name)) throw new TypeError(`contentSecurityPolicy: invalid directive name ${JSON.stringify(name)}`);
    if (!Array.isArray(sources)) throw new TypeError(`contentSecurityPolicy: ${name} must be an array of sources`);
    for (const source of sources as readonly unknown[]) {
      if (typeof source !== "string" || !sourceToken.test(source)) throw new TypeError(`contentSecurityPolicy: invalid source ${JSON.stringify(source)} in ${name}`);
    }
    directives.set(name, [...sources]);
  }
  if (scriptHashes.length) {
    // `<script>` elements follow script-src-elem when the policy has it, else script-src, else default-src.
    const name = directives.has("script-src-elem") ? "script-src-elem" : "script-src";
    const base = directives.get(name) ?? directives.get("default-src");
    if (base) {
      // The hashes allow inline scripts; a directive copied from default-src keeps what it allowed.
      directives.set(name, [...new Set([...base, ...scriptHashes])]);
    }
  }
  if (styleHashes.length) {
    // `<style>` elements follow style-src-elem when the policy has it, else style-src, else default-src.
    const name = directives.has("style-src-elem") ? "style-src-elem" : "style-src";
    const base = directives.get(name) ?? directives.get("default-src");
    // With a hash the browser ignores 'unsafe-inline', which also allows the style attributes.
    if (base && !base.some((source) => source.toLowerCase() === "'unsafe-inline'")) {
      directives.set(name, [...new Set([...base, ...styleHashes])]);
    }
  }
  return [...directives].map(([name, sources]) => [name, ...sources].join(" ")).join("; ");
}

/** `'nonce-<base64>'`; base64url characters are valid too. */
const nonceSource = /^'nonce-[A-Za-z0-9+/_-]+={0,2}'$/;

/**
 * The policy of JSON responses (API, RPC and navigation payloads), which run no script and embed
 * nothing: no source of any kind, and no framing.
 */
export const JSON_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

/**
 * The header of a server-rendered document with its nonce or the hashes of its inline scripts and
 * styles. Unlike {@link contentSecurityPolicy}, no source is added to a directive that allows
 * `'unsafe-inline'`, for scripts as for styles: a nonce or a hash makes the browser ignore
 * `'unsafe-inline'`, which the policy keeps for what neither can allow (`style="…"` attributes,
 * `on*` handlers). A directive with `'strict-dynamic'` is the exception: there the browser already
 * ignores `'unsafe-inline'` (it stays only for older browsers) and the host sources, so only a
 * nonce or a hash lets Meeko's scripts run. The policy was validated when the configuration was
 * loaded.
 */
export function documentContentSecurityPolicy(policy: ContentSecurityPolicy, scriptSources: readonly string[], styleSources: readonly string[]): string {
  for (const source of [...scriptSources, ...styleSources]) {
    if (!hashSource.test(source) && !nonceSource.test(source)) throw new TypeError(`contentSecurityPolicy: invalid source ${JSON.stringify(source)}`);
  }
  const directives = new Map<string, string[]>(Object.entries(policy).map(([name, sources]) => [name, [...sources]]));
  const has = (sources: readonly string[], keyword: string): boolean => sources.some((source) => source.toLowerCase() === keyword);
  const extend = (name: string, base: readonly string[] | undefined, sources: readonly string[]): void => {
    if (!sources.length || !base) return;
    if (has(base, "'unsafe-inline'") && !has(base, "'strict-dynamic'")) return;
    directives.set(name, [...new Set([...base, ...sources])]);
  };
  // `<script>` elements follow script-src-elem when the policy has it, else script-src, else default-src.
  const script = directives.has("script-src-elem") ? "script-src-elem" : "script-src";
  extend(script, directives.get(script) ?? directives.get("default-src"), scriptSources);
  // `<style>` elements follow style-src-elem when the policy has it, else style-src, else default-src.
  const style = directives.has("style-src-elem") ? "style-src-elem" : "style-src";
  extend(style, directives.get(style) ?? directives.get("default-src"), styleSources);
  return [...directives].map(([name, sources]) => [name, ...sources].join(" ")).join("; ");
}

/** A fresh CSP nonce for one response: 128 random bits in base64url. */
export function createCspNonce(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}
