/** A build output file that the host may serve publicly. */
export interface AssetRecord {
  /** Value of the `content-type` header. */
  readonly type: string;
  /** Strong validator derived from the file contents. */
  readonly etag: string;
  readonly size: number;
  /** Content-hashed files never change under the same URL. */
  readonly immutable?: boolean;
}

/** Public build files keyed by their URL pathname. Unlisted paths are never read. */
export type AssetManifest = Readonly<Record<string, AssetRecord>>;

/** Serves listed build files; returns null when the request is not a listed asset. */
export interface AssetReader {
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
