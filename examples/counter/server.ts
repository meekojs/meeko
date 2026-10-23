import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { serializeJson } from "meeko";
import { css, renderToString, type ComponentProps } from "./Counter.generated.ts";

/** Genera la página completa con HTML inicial y props para hidratación. */
export function renderExamplePage(props: ComponentProps): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meeko SSR</title><style>${css}</style></head><body><main><h1>Meeko SSR</h1><div id="app">${renderToString(props)}</div></main><script id="meeko-props" type="application/json">${serializeJson(props)}</script><script type="module" src="/client.js"></script></body></html>`;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  const port = Number(process.env.PORT ?? "4173");
  const bundleUrl = new URL("./client.bundle.js", import.meta.url);
  const server = createServer(async (request, response) => {
    if (request.url === "/client.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(await readFile(bundleUrl));
      return;
    }
    if (request.url !== "/") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderExamplePage({ initial: 2 }));
  });
  server.listen(port, "127.0.0.1", () => process.stdout.write(`http://127.0.0.1:${port}\n`));
}
