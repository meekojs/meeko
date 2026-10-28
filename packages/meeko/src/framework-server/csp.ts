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
 * Con hashes en `script-src`, el navegador ignora `'unsafe-inline'` de esa directiva.
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
    const base = directives.get("script-src") ?? directives.get("default-src");
    if (base) {
      // The hashes allow inline scripts; a directive copied from default-src keeps what it allowed.
      directives.set("script-src", [...new Set([...base, ...scriptHashes])]);
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
