import { Readable } from "node:stream";
import { TLSSocket } from "node:tls";
import type { IncomingMessage, ServerResponse } from "node:http";

export { discoverRoutes, createFrameworkHandler } from "./framework/server.js";
export type { FrameworkHandlerOptions, PageModule, PageRoute, PageRequestContext } from "./framework/server.js";
export { composeFrameworkRoutes } from "./framework/modules.js";
export { discoverConfiguredRoutes, loadMeekoConfig, resolveConfigSources, readMeekoConfigSync } from "./framework/config.js";
export type { MeekoConfig, ConfigSource } from "./framework/config.js";
export type { RouteLayer, RouteModule, ComposeRoutesOptions } from "./framework/modules.js";
export { prerenderRoutes, prerenderProject } from "./framework/prerender.js";
export type { PrerenderOptions } from "./framework/prerender.js";
export * from "./framework-server.js";

/** Adapts a portable Fetch handler to Node 24's HTTP server callback. */
export function toNodeListener(handler: (request: Request) => Promise<Response> | Response): (request: IncomingMessage, response: ServerResponse) => void {
  return (incoming, outgoing) => {
    void (async () => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      incoming.once("aborted", abort);
      outgoing.once("close", abort);
      try {
      const authority = incoming.headers.host ?? "localhost";
      const protocol = incoming.socket instanceof TLSSocket ? "https" : "http";
      const url = new URL(incoming.url ?? "/", `${protocol}://${authority}`);
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
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      if (method === "HEAD" || !result.body) { outgoing.end(); return; }
      for await (const chunk of result.body) outgoing.write(chunk);
      outgoing.end();
      } finally {
        incoming.off("aborted", abort);
        outgoing.off("close", abort);
      }
    })().catch(() => {
      if (!outgoing.headersSent) outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      outgoing.end("Internal server error");
    });
  };
}
