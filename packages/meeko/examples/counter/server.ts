import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { serializeJson } from "@meekojs/meeko";
import { css, renderWithState, type ComponentProps } from "./Counter.generated.ts";

/** Genera la página completa con HTML inicial y props para hidratación. */
export function renderExamplePage(props: ComponentProps): string {
  const rendered = renderWithState(props);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/png" href="/meeko-logo.png"><title>Meeko SSR</title><style>${css}</style></head><body><main><img src="/meeko-logo.png" alt="Meeko" width="96" height="96"><h1>Meeko SSR</h1><nav><a href="/">Inicio</a> <a href="/?initial=5">Otro valor</a></nav><div id="app">${rendered.html}</div></main><script id="meeko-payload" type="application/json">${serializeJson({ props, state: rendered.state })}</script><script type="module" src="/client.js"></script></body></html>`;
}

/** Crea el servidor HTTP del ejemplo para pruebas y ejecución local. */
export function createExampleServer(): ReturnType<typeof createServer> {
  const bundleUrl = new URL("./client.bundle.js", import.meta.url);
  const logoUrl = new URL("../../../../assets/brand/meeko-logo.png", import.meta.url);
  return createServer(async (request, response) => {
    if (request.url === "/meeko-logo.png") {
      response.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600" });
      response.end(await readFile(logoUrl));
      return;
    }
    if (request.url === "/client.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(await readFile(bundleUrl));
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderExamplePage({ initial: url.searchParams.get("initial") === "5" ? 5 : 2 }));
  });
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  const port = Number(process.env.PORT ?? "4173");
  const server = createExampleServer();
  server.listen(port, "127.0.0.1", () => process.stdout.write(`http://127.0.0.1:${port}\n`));
}
