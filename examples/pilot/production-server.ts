import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { HotState } from "@meekojs/meeko";
import { initialTasks, type Task, type TaskView } from "./model.js";
import { renderPilotPage } from "./page.js";

const outputRoot = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(outputRoot, "../client");

interface AppModule {
  renderWithState(props: { view: TaskView; tasks: Task[] }): { html: string; state: HotState };
}

const contentTypes: Record<string, string> = {
  "/client.js": "text/javascript; charset=utf-8",
  "/style.css": "text/css; charset=utf-8",
  "/meeko-logo.png": "image/png",
};

/** Sirve los artefactos compilados sin middleware ni transformaciones de Vite. */
export async function createProductionPilotServer(): Promise<Server> {
  const app = await import(new URL("./app.js", import.meta.url).href) as AppModule;
  return createHttpServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/tasks") {
        await new Promise<void>((done) => setTimeout(done, 120));
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify([...initialTasks, { id: "release", title: "Preparar lanzamiento", detail: "Revisar la versión y sus artefactos.", done: false }]));
        return;
      }
      const contentType = contentTypes[url.pathname];
      if (request.method === "GET" && contentType) {
        response.writeHead(200, { "content-type": contentType, "cache-control": "public, max-age=3600" });
        response.end(await readFile(resolve(clientRoot, url.pathname.slice(1))));
        return;
      }
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/completed")) {
        const view: TaskView = url.pathname === "/completed" ? "completed" : "active";
        const tasks = initialTasks.map((task) => ({ ...task }));
        const document = renderPilotPage(view, app.renderWithState({ view, tasks }), tasks, "/client.js");
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(document);
        return;
      }
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("No encontrado");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end((error as Error).message);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createProductionPilotServer();
  const port = Number(process.env.PORT ?? "4174");
  server.listen(port, "127.0.0.1", () => {
    const address = server.address() as AddressInfo;
    process.stdout.write(`http://127.0.0.1:${address.port}\n`);
  });
}
