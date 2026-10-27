import { basename, relative, sep } from "node:path";
import { sectionAttribute } from "../compiler/generic.js";
import { compileError, MeekoCompileError, parseSfc } from "../compiler/sfc.js";

/**
 * Module id suffix of a page's `<script server>` block. The `lang.ts` ending
 * makes Vite transform it as TypeScript; the path before `?` keeps relative
 * imports resolving from the page's own directory.
 */
export const routeBlockQuery = "?meeko-route&lang.ts";

/** Module id of the route options embedded in `file`. */
export function routeBlockId(file: string): string {
  return file + routeBlockQuery;
}

/** The `.meeko` file behind a route block id, or undefined for any other id. */
export function routeBlockFile(id: string): string | undefined {
  return id.endsWith(routeBlockQuery) ? id.slice(0, -routeBlockQuery.length) : undefined;
}

/**
 * Returns the `<script server>` block as a TypeScript module whose offsets,
 * lines and columns match the `.meeko` file, or undefined when it has none.
 * Everything before the block becomes whitespace with the original newlines.
 */
export function routeBlockSource(source: string, filename: string): string | undefined {
  const server = parseSfc(source, filename).server;
  if (!server) return undefined;
  return source.slice(0, server.contentStart).replace(/[^\r\n]/g, " ") + server.content;
}

/**
 * The `.meeko` source with its `<script server>` block blanked out, keeping
 * every offset. Source maps of the compiled component embed this text, so the
 * route options never travel with the component.
 */
export function withoutRouteBlock(source: string, filename: string): string {
  if (!source.includes("server")) return source;
  const server = parseSfc(source, filename).server;
  if (!server) return source;
  return source.slice(0, server.start) + source.slice(server.start, server.end).replace(/[^\r\n]/g, " ") + source.slice(server.end);
}

/** A routable page: a `.meeko` under some source's `app/pages`, not a `+layout` or `+error`. */
export function isPageFile(file: string, sourceRoots: readonly string[]): boolean {
  if (basename(file).startsWith("+")) return false;
  return sourceRoots.some((root) => {
    const path = relative(root, file);
    return path.startsWith(`app${sep}pages${sep}`) || path.startsWith("app/pages/");
  });
}

/** Una página, un layout, `app.meeko` o `app/error.meeko`: el propio Meeko les pasa sus props. */
function isShellFile(file: string, sourceRoots: readonly string[]): boolean {
  return sourceRoots.some((root) => {
    const path = relative(root, file).replaceAll("\\", "/");
    return path.startsWith("app/pages/") || path.startsWith("app/layouts/") || path === "app/app.meeko" || path === "app/error.meeko";
  });
}

/**
 * Rechaza `<script server>` fuera de una página, donde se ignorarían sus opciones de ruta (MEEK044),
 * y `generic` en una página, un layout, `app.meeko` o una página de error (MEEK100): Meeko les pasa
 * sus props y no puede elegir sus argumentos de tipo.
 */
export function assertRouteBlockPlacement(source: string, filename: string, sourceRoots: readonly string[]): void {
  const usesServer = source.includes("server");
  const usesGeneric = source.includes("generic");
  if (!usesServer && !usesGeneric) return;
  const document = parseSfc(source, filename);
  if (document.server && !isPageFile(filename, sourceRoots)) {
    throw compileError(source, filename, "MEEK044", "<script server> declara opciones de ruta y sólo se admite en las páginas de app/pages", document.server.start);
  }
  const generic = usesGeneric ? sectionAttribute(source, document.script, "generic") : undefined;
  if (generic && isShellFile(filename, sourceRoots)) {
    throw compileError(source, filename, "MEEK100", "Las páginas, los layouts, app.meeko y las páginas de error no pueden ser genéricos: Meeko les pasa sus props y no puede elegir sus parámetros de tipo; quita generic o lleva el contenido genérico a un componente de app/components", generic.start);
  }
}

/**
 * Like `routeBlockSource`, but a component that does not compile counts as
 * having no block: the page's own compilation reports that error.
 */
export function tryRouteBlockSource(source: string, filename: string): string | undefined {
  if (!source.includes("server")) return undefined;
  try { return routeBlockSource(source, filename); }
  catch (error) {
    if (error instanceof MeekoCompileError) return undefined;
    throw error;
  }
}
