import { createHash } from "node:crypto";
import { inlineSources } from "./inline-sources.js";

/**
 * Resultado de {@link inlineScriptHashes}.
 *
 * @since 1.3.0
 * @example
 * ```ts
 * import { inlineScriptHashes } from "@meekojs/meeko/build";
 * import type { InlineScriptReport } from "@meekojs/meeko/build";
 *
 * const report: InlineScriptReport = inlineScriptHashes("<script>console.log(1)</script>");
 * console.log(report.hashes, report.unhashable);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#csp-con-hashes
 */
export interface InlineScriptReport {
  /** Fuentes CSP `'sha256-<base64>'` de los scripts en línea ejecutables, ordenadas y sin repetir. */
  readonly hashes: readonly string[];
  /**
   * JavaScript del documento que ningún hash puede permitir en `script-src`: atributos `on*`
   * (`<button onclick>`) y URL `javascript:` (`<a href="javascript:…">`), descritos para un
   * mensaje de error.
   */
  readonly unhashable: readonly string[];
}

/** The CSP source `'sha256-…'` of an inline text. */
function sha256Source(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/**
 * Calcula el hash SHA-256 (base64) de cada `<script>` en línea de un documento HTML que el
 * navegador comprueba con `script-src`: los de JavaScript, `module`, `importmap` y
 * `speculationrules`. Los bloques de datos (`application/json`, `application/ld+json`, el payload
 * de Meeko) y los scripts con `src` no cuentan. El texto se lee como lo hace el navegador, así que
 * el hash coincide con el que comprueba.
 *
 * @param html Documento HTML completo.
 * @returns Los hashes como fuentes CSP y el JavaScript que un hash no puede permitir.
 * @since 1.3.0
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import { inlineScriptHashes } from "@meekojs/meeko/build";
 * import { contentSecurityPolicy } from "@meekojs/meeko/server";
 *
 * const { hashes, unhashable } = inlineScriptHashes(await readFile("dist/index.html", "utf8"));
 * if (unhashable.length) throw new Error(`JavaScript en línea sin hash: ${unhashable.join(", ")}`);
 * const header = contentSecurityPolicy({ "default-src": ["'self'"] }, hashes);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#csp-con-hashes
 */
export function inlineScriptHashes(html: string): InlineScriptReport {
  const { scripts, unhashable } = inlineSources(html);
  return { hashes: [...new Set(scripts.map(sha256Source))].sort(), unhashable };
}

/**
 * Calcula el hash SHA-256 (base64) de cada `<style>` en línea de un documento HTML, como fuentes
 * CSP `'sha256-…'` para `style-src`: el estilo que añade `theme` para `<MeekoThemeToggle>` y los
 * `<style>` de los componentes. Los atributos `style="…"` no cuentan, porque un hash no los
 * permite. El texto se lee como lo hace el navegador, así que el hash coincide con el que éste
 * comprueba.
 *
 * @param html Documento HTML completo.
 * @returns Los hashes como fuentes CSP, ordenados y sin repetir.
 * @since 1.4.0
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import { inlineScriptHashes, inlineStyleHashes } from "@meekojs/meeko/build";
 * import { contentSecurityPolicy } from "@meekojs/meeko/server";
 *
 * const html = await readFile("dist/index.html", "utf8");
 * const header = contentSecurityPolicy({ "default-src": ["'self'"] }, inlineScriptHashes(html).hashes, inlineStyleHashes(html));
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#csp-con-hashes
 */
export function inlineStyleHashes(html: string): readonly string[] {
  return [...new Set(inlineSources(html).styles.map(sha256Source))].sort();
}
