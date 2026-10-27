/**
 * Un archivo del build que el host puede servir públicamente.
 *
 * @example
 * ```ts
 * import type { AssetRecord } from "@meekojs/meeko/server";
 *
 * const logo: AssetRecord = { type: "image/png", etag: "\"k3Jd9s\"", size: 5120 };
 * ```
 */
export interface AssetRecord {
  /** Valor de la cabecera `content-type`. */
  readonly type: string;
  /** Validador fuerte derivado del contenido. */
  readonly etag: string;
  /** Tamaño en bytes (`content-length`). */
  readonly size: number;
  /** Los archivos con hash de contenido nunca cambian bajo la misma URL; se sirven como `immutable`. */
  readonly immutable?: boolean;
}

/**
 * Archivos públicos del build por ruta de URL, tal como la serializa la URL WHATWG. Las rutas que
 * no figuran nunca se leen del disco.
 *
 * @example
 * ```ts
 * import type { AssetManifest } from "@meekojs/meeko/server";
 *
 * const assets: AssetManifest = {
 *   "/assets/entry-4f2a.js": { type: "text/javascript", etag: "\"a1\"", size: 20480, immutable: true },
 *   "/logo@2x.png": { type: "image/png", etag: "\"b2\"", size: 5120 },
 * };
 * ```
 */
export type AssetManifest = Readonly<Record<string, AssetRecord>>;

/**
 * Sirve los archivos listados del build. Cada adaptador ofrece uno: `createNodeAssetReader`,
 * `createBunAssetReader`, `createDenoAssetReader` y `createCloudflareAssetReader`.
 *
 * @example
 * ```ts
 * import type { AssetReader } from "@meekojs/meeko/server";
 *
 * const robots: AssetReader = {
 *   async get(pathname) {
 *     if (pathname !== "/robots.txt") return null;
 *     return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
 *   },
 * };
 * ```
 */
export interface AssetReader {
  /** Devuelve la respuesta del archivo, con `ETag`, `HEAD` y `304`, o `null` si no es un archivo listado. */
  get(pathname: string, request: Request): Promise<Response | null>;
}

/** Weak comparison used for `If-None-Match`, as required for GET and HEAD. */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const opaque = etag.replace(/^W\//, "");
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value.replace(/^W\//, "") === opaque;
  });
}

/** Looks up a request pathname without decoding it, so no traversal form can match. */
export function findAsset(assets: AssetManifest, pathname: string, request: Request): AssetRecord | undefined {
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  return Object.hasOwn(assets, pathname) ? assets[pathname] : undefined;
}

/**
 * Locates a manifest key under an output directory. Keys are percent-encoded
 * build paths, so URL roots resolve them directly and path roots decode them.
 */
export function assetLocation(root: string | URL, pathname: string): string | URL {
  if (root instanceof URL) {
    const directory = root.href.endsWith("/") ? root : new URL(`${root.href}/`);
    return new URL(`.${pathname}`, directory);
  }
  return [root.replace(/[\\/]+$/, ""), ...pathname.split("/").filter(Boolean).map(decodeURIComponent)].join("/");
}

/** Builds the shared response for a listed asset: validators, HEAD and cache policy. */
export function assetResponse(record: AssetRecord, request: Request, body: () => BodyInit | null): Response {
  const headers = new Headers({
    "content-type": record.type,
    etag: record.etag,
    "cache-control": record.immutable ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
  });
  if (etagMatches(request.headers.get("if-none-match"), record.etag)) return new Response(null, { status: 304, headers });
  headers.set("content-length", String(record.size));
  return new Response(request.method === "HEAD" ? null : body(), { status: 200, headers });
}
