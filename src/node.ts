import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { TLSSocket } from "node:tls";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, errorResponse, observeServerError } from "./framework-server/contracts.js";

export { discoverRoutes, createFrameworkHandler } from "./framework/server.js";
export type { FrameworkHandlerOptions, PageModule, PageRoute, PageRequestContext } from "./framework/server.js";
export { composeFrameworkRoutes } from "./framework/modules.js";
export { discoverConfiguredRoutes, loadMeekoConfig, resolveConfigSources, readMeekoConfigSync } from "./framework/config.js";
export type { MeekoConfig, ConfigSource } from "./framework/config.js";
export type { RouteLayer, RouteModule, ComposeRoutesOptions } from "./framework/modules.js";
export { prerenderRoutes, prerenderProject } from "./framework/prerender.js";
export type { PrerenderOptions } from "./framework/prerender.js";
export * from "./framework-server.js";

export interface NodeListenerOptions {
  /** Receives uncaught handler or response-stream failures with a correlation ID. */
  onError?: (error: unknown, requestId: string) => void;
}

function nodeResponseHeaders(headers: Headers): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  headers.forEach((value, name) => { result[name] = value; });
  const cookies = headers.getSetCookie();
  if (cookies.length) result["set-cookie"] = cookies;
  return result;
}

/** Adapts a portable Fetch handler to Node 24's HTTP server callback. */
export function toNodeListener(handler: (request: Request) => Promise<Response> | Response, options: NodeListenerOptions = {}): (request: IncomingMessage, response: ServerResponse) => void {
  return (incoming, outgoing) => {
    let responseRequestId: string | undefined;
    void (async () => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      incoming.once("aborted", abort);
      outgoing.once("close", abort);
      try {
      const authority = incoming.headers.host ?? "localhost";
      const protocol = incoming.socket instanceof TLSSocket ? "https" : "http";
      let url: URL;
      try { url = new URL(incoming.url ?? "/", `${protocol}://${authority}`); }
      catch { throw new ApiError("INVALID_URL", 400); }
      const method = incoming.method ?? "GET";
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const hasBody = method !== "GET" && method !== "HEAD";
      const request = new Request(url, {
        method, headers, signal: controller.signal,
        ...(hasBody ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: "half" as const } : {}),
      });
      const result = await handler(request);
      const candidateRequestId = result.headers.get("x-request-id");
      if (candidateRequestId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateRequestId)) {
        responseRequestId = candidateRequestId;
      }
      if (controller.signal.aborted || outgoing.destroyed) return;
      outgoing.writeHead(result.status, nodeResponseHeaders(result.headers));
      if (method === "HEAD" || !result.body) { outgoing.end(); return; }
      const reader = result.body.getReader();
      try {
        while (true) {
          if (controller.signal.aborted || outgoing.destroyed) { await reader.cancel(); return; }
          const chunk = await reader.read();
          if (chunk.done) break;
          if (controller.signal.aborted || outgoing.destroyed) { await reader.cancel(); return; }
          outgoing.write(chunk.value);
        }
      } finally { reader.releaseLock(); }
      if (!controller.signal.aborted && !outgoing.destroyed) outgoing.end();
      } finally {
        incoming.off("aborted", abort);
        outgoing.off("close", abort);
      }
    })().catch(async (error: unknown) => {
      const requestId = responseRequestId ?? randomUUID();
      observeServerError(error, requestId, options.onError);
      if (outgoing.destroyed) return;
      const reportSecondary = (failure: unknown): void => {
        if (!Object.is(failure, error)) observeServerError(failure, requestId, options.onError);
      };
      const destroySafely = (cause: unknown): void => {
        try { outgoing.destroy(cause instanceof Error ? cause : undefined); }
        catch (destroyError) {
          if (!Object.is(destroyError, error) && !Object.is(destroyError, cause)) {
            observeServerError(destroyError, requestId, options.onError);
          }
        }
      };
      if (outgoing.headersSent) { destroySafely(error); return; }
      try {
        const failure = errorResponse(error, requestId);
        outgoing.writeHead(failure.status, nodeResponseHeaders(failure.headers));
        outgoing.end(incoming.method === "HEAD" ? undefined : await failure.text());
      } catch (failure) {
        reportSecondary(failure);
        destroySafely(failure);
      }
    });
  };
}
