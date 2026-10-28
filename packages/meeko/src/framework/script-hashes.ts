import { createHash } from "node:crypto";
import { parse } from "parse5";

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

interface Parse5Node {
  readonly nodeName: string;
  readonly tagName?: string;
  readonly value?: string;
  readonly attrs?: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly childNodes?: readonly Parse5Node[];
  readonly content?: Parse5Node;
}

/** The JavaScript MIME type essences of the HTML standard. */
const javascriptTypes = new Set([
  "application/ecmascript", "application/javascript", "application/x-ecmascript", "application/x-javascript", "text/ecmascript",
  "text/javascript", "text/javascript1.0", "text/javascript1.1", "text/javascript1.2", "text/javascript1.3", "text/javascript1.4",
  "text/javascript1.5", "text/jscript", "text/livescript", "text/x-ecmascript", "text/x-javascript",
]);
/** Non-JavaScript `type` values that `script-src` still governs. */
const scriptBlockTypes = new Set(["module", "importmap", "speculationrules"]);
/** Attributes that navigate to or load a URL, where `javascript:` runs code. */
const urlAttributes = new Set(["href", "src", "action", "formaction", "xlink:href", "data"]);

/**
 * Whether a `<script type>` runs (or, like an import map, is checked by `script-src`); a data
 * block such as `application/json` or `application/ld+json` is not.
 */
function governedByScriptSrc(type: string | undefined): boolean {
  if (type === undefined) return true;
  const value = type.trim().toLowerCase();
  if (value === "" || scriptBlockTypes.has(value)) return true;
  return javascriptTypes.has(value.split(";")[0]!.trim());
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
  const hashes = new Set<string>();
  const unhashable: string[] = [];
  const visit = (node: Parse5Node): void => {
    const tag = node.tagName;
    if (tag !== undefined) {
      const attributes = node.attrs ?? [];
      for (const { name, value } of attributes) {
        const lower = name.toLowerCase();
        if (lower.startsWith("on")) unhashable.push(`<${tag} ${lower}>`);
        // The URL parser strips leading spaces and controls, and drops tabs and newlines.
        else if (urlAttributes.has(lower) && /^javascript:/i.test(value.replace(/^[\u0000- ]+/, "").replace(/[\t\n\r]/g, ""))) {
          unhashable.push(`<${tag} ${lower}="${value.slice(0, 40)}">`);
        }
      }
      if (tag === "script" && !attributes.some((attribute) => attribute.name.toLowerCase() === "src")) {
        const type = attributes.find((attribute) => attribute.name.toLowerCase() === "type")?.value;
        if (governedByScriptSrc(type)) {
          const text = (node.childNodes ?? []).map((child) => child.nodeName === "#text" ? child.value ?? "" : "").join("");
          hashes.add(`'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`);
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parse(html) as unknown as Parse5Node);
  return { hashes: [...hashes].sort(), unhashable };
}
