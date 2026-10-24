import { mountClientApp, type ClientComponent, type RouteRecord } from "@meekojs/meeko/framework";
import { modules as pages } from "virtual:meeko-client-pages";

const root = document.getElementById("app");
const payload = document.getElementById("meeko-payload")?.textContent;
const routesText = document.getElementById("meeko-routes")?.textContent;
if (!root || !payload || !routesText) throw new Error("Missing Meeko SSR data");
const routes = JSON.parse(routesText) as RouteRecord[];

performance.mark("meeko-hydration-start");
const app = await mountClientApp({
  root, payload, routes, serverData: true,
  async loadPage(file) {
    const load = pages[file];
    if (!load) throw new Error("Page module missing: " + file);
    return await load() as ClientComponent;
  },
});
performance.mark("meeko-hydration-end");
performance.measure("meeko-hydration", "meeko-hydration-start", "meeko-hydration-end");
Object.defineProperty(window, "__meekoTestApp", { value: app });
