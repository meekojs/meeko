import { analyzeServerScript, frameworkModule } from "../compiler/server-script.js";
import type { ServerScript } from "../compiler/server-script.js";
import type { SourceMapping } from "../compiler/mapping.js";
import { sourceMapForCompiled } from "../compiler/sourcemap.js";
import { parseSfc } from "../compiler/sfc.js";

/** The page's `<script server>` section and what it declares, or undefined without one. */
export function readServerScript(source: string, filename: string): { readonly script: ServerScript; readonly contentStart: number; readonly content: string } | undefined {
  const server = parseSfc(source, filename).server;
  if (!server) return undefined;
  return { script: analyzeServerScript(source, filename, server), contentStart: server.contentStart, content: server.content };
}

function blank(text: string): string {
  return text.replace(/[^\r\n]/g, " ");
}

/**
 * Runtime module of a `<script server>` with top-level code, or undefined when
 * the block only declares route options and loads as written. The code runs
 * inside an async function per request; its imports, types and route options
 * move after it to module scope. Kept code stays on its own line and column.
 */
export function serverScriptModule(source: string, filename: string): { readonly code: string; readonly map: object } | undefined {
  const read = readServerScript(source, filename);
  if (!read?.script.body) return undefined;
  const { script } = read;
  // Offsets of the block are offsets of the `.meeko` file: everything before it is blank.
  const block = blank(source.slice(0, read.contentStart)) + read.content;
  let kept = block;
  const moved: Array<{ start: number; end: number }> = [];
  for (const statement of script.statements) {
    if (statement.kind === "body") {
      if (statement.exportKeyword) kept = kept.slice(0, statement.exportKeyword.start) + blank(kept.slice(statement.exportKeyword.start, statement.exportKeyword.end)) + kept.slice(statement.exportKeyword.end);
      continue;
    }
    kept = kept.slice(0, statement.start) + blank(kept.slice(statement.start, statement.end)) + kept.slice(statement.end);
    if (statement.kind !== "route") moved.push(statement);
  }
  const mappings: SourceMapping[] = [];
  let code = "async function __meeko_body() {";
  const mapped = (text: string, originalStart: number): void => {
    mappings.push({ generatedStart: code.length, generatedEnd: code.length + text.length, originalStart, originalLength: text.length });
    code += text;
  };
  mapped(kept, 0);
  const data = script.exports.map((binding) => binding.name).join(", ");
  code += `\nreturn { data: { ${data} }${script.head ? ", head" : ""} };\n}\n`;
  for (const statement of moved) {
    mapped(block.slice(statement.start, statement.end), statement.start);
    code += "\n";
  }
  code += 'import { definePageBody as __meeko_definePageBody } from "@meekojs/meeko/internal";\n';
  if (script.implicit.length) code += `import { ${script.implicit.join(", ")} } from ${JSON.stringify(frameworkModule)};\n`;
  const route = script.route;
  if (route && route.initializerEnd > route.initializerStart) {
    code += "const __meeko_route = ";
    mapped(block.slice(route.initializerStart, route.initializerEnd), route.initializerStart);
    code += ";\n";
  }
  code += `export const route = __meeko_definePageBody(${route && route.initializerEnd > route.initializerStart ? "__meeko_route" : "undefined"}, __meeko_body, ${script.head !== undefined});\n`;
  return { code, map: sourceMapForCompiled(code, source, filename, mappings) };
}

/**
 * TypeScript copy of a `<script server>` for type checking, with the same
 * offsets as `text`, which starts at `textStart` in the `.meeko` file. With
 * top-level code, `usePage()` is typed from the route options and `routeId`,
 * implicit request APIs are imported and `head` is checked; declarations are
 * appended after the block.
 */
export function serverScriptTypes(text: string, textStart: number, script: ServerScript, routeId: string | undefined): string {
  if (!script.body) return text;
  let code = text;
  for (const entry of script.usePageImports) {
    const start = entry.start - textStart;
    const end = entry.end - textStart;
    if (start < 0 || end > code.length) continue;
    code = code.slice(0, start) + blank(code.slice(start, end)) + code.slice(end);
  }
  const framework = JSON.stringify(frameworkModule);
  const request = `import(${framework}).PageRequestOf<${script.route ? "typeof route" : "undefined"}, ${JSON.stringify(routeId ?? "")}>`;
  const lines = [""];
  const locals = new Set(script.usePageImports.map((entry) => entry.local));
  if (script.implicit.includes("usePage")) locals.add("usePage");
  for (const local of locals) lines.push(`declare function ${local}(): ${request};`);
  const imported = script.implicit.filter((api) => api !== "usePage");
  if (imported.length) lines.push(`import { ${imported.join(", ")} } from ${framework};`);
  if (script.head) lines.push(`void (head satisfies import(${framework}).PageBodyHead);`);
  lines.push("export {};", "");
  return code + lines.join("\n");
}

/** Route id of a page from its path under `app/pages`, or undefined outside one. */
export function pageRouteId(file: string): string | undefined {
  const path = file.replaceAll("\\", "/");
  const index = path.lastIndexOf("/app/pages/");
  if (index < 0 || !path.endsWith(".meeko")) return undefined;
  const parts = path.slice(index + "/app/pages/".length, -".meeko".length).split("/");
  if (parts.at(-1) === "index") parts.pop();
  const visible = parts.filter((part) => !/^\([^/()]+\)$/.test(part));
  return visible.length ? `/${visible.join("/")}` : "/";
}
