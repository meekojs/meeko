import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { HotState } from "@meekojs/meeko";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { initialTasks, type Task, type TaskView } from "./model.js";
import { renderPilotPage } from "./page.js";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const logoFile = resolve(projectRoot, "../../../../assets/brand/meeko-logo.png");

interface AppModule {
  renderWithState(props: { view: TaskView; tasks: Task[] }): { html: string; state: HotState };
}

/** Inicia Vite como transformador y un servidor HTTP que entrega SSR y API. */
export async function createPilotServer(): Promise<{ server: Server; vite: ViteDevServer; close(): Promise<void> }> {
  let vite: ViteDevServer;
  const server = createHttpServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/tasks") {
        await new Promise<void>((done) => setTimeout(done, 120));
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify([...initialTasks, { id: "release", title: "Preparar lanzamiento", detail: "Revisar la versión y sus artefactos.", done: false }]));
        return;
      }
      if (request.method === "GET" && url.pathname === "/meeko-logo.png") {
        response.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600" });
        response.end(await readFile(logoFile));
        return;
      }
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/completed")) {
        const view: TaskView = url.pathname === "/completed" ? "completed" : "active";
        const tasks = initialTasks.map((task) => ({ ...task }));
        const app = await vite.ssrLoadModule(resolve(projectRoot, "App.meeko")) as AppModule;
        const document = renderPilotPage(view, app.renderWithState({ view, tasks }), tasks, "/client.ts");
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(document);
        return;
      }
      vite.middlewares(request, response, () => {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("No encontrado");
      });
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end((error as Error).message);
    }
  });
  vite = await createViteServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    root: projectRoot,
    server: { middlewareMode: true, hmr: { server } },
    appType: "custom",
  });
  return {
    server,
    vite,
    async close(): Promise<void> {
      await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
      await vite.close();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pilot = await createPilotServer();
  const port = Number(process.env.PORT ?? "4174");
  pilot.server.listen(port, "127.0.0.1", () => {
    const address = pilot.server.address() as AddressInfo;
    process.stdout.write(`http://127.0.0.1:${address.port}\n`);
  });
}
