import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineMeekoModule } from "@meekojs/meeko/framework";

/** Options of the fixture module; `meeko.config.ts` sets them under `hello` or with `[hello, options]`. */
export interface HelloOptions {
  greeting: string;
  mark: string;
  siteUrl: string;
}

declare module "@meekojs/meeko/framework" {
  interface MeekoConfig {
    readonly hello?: Partial<HelloOptions>;
  }
}

/** Exercises every module API: see tests/framework-module-system.test.ts. */
export default defineMeekoModule<HelloOptions>({
  meta: { name: "hello", configKey: "hello", compatibility: { meeko: ">=1.1 <2" } },
  defaults: { greeting: "Hola", mark: "default", siteUrl: "https://example.test" },
  setup(options, meeko) {
    const here = (path: string): URL => new URL(path, import.meta.url);
    let routes: readonly { readonly id: string }[] = [];
    const prerendered: string[] = [];
    meeko.hooks.hook("ready", () => { meeko.warn(`ready (${meeko.dev ? "dev" : "build"})`); });
    meeko.hooks.hook("routes:resolved", (context) => { routes = context.routes; });
    meeko.hooks.hook("prerender:routes", ({ urls }) => { prerendered.push(...urls); });
    meeko.hooks.hook("build:done", async ({ adapter, output }) => {
      await writeFile(join(output, "hello-build.json"), JSON.stringify({ adapter, prerendered }));
    });

    meeko.addLayer(here("./layer"));
    meeko.addComponentsDir(here("./components"), { prefix: "Hello" });
    meeko.addAutoImportsDir(here("./composables"), { scope: "app" });
    meeko.addAutoImports({ name: "useHelloGreeting", from: here("./runtime/greeting.ts") });

    meeko.addPlugin({ src: here("./runtime/greeting.plugin.ts"), options: { greeting: options.greeting } });
    meeko.addPlugin({ src: here("./runtime/mark.client.ts"), options: { mark: options.mark } });
    meeko.addPlugin(here("./runtime/stats.server.ts"));

    meeko.addServerMiddleware(here("./runtime/header.ts"));
    meeko.addServerHandler({ route: "/__hello/stats", handler: here("./runtime/stats-handler.ts") });

    meeko.addPublicFile("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${options.siteUrl}/sitemap.xml\n`);
    meeko.addPublicFile("sitemap.xml", () => [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...routes.filter((route) => !route.id.includes("[")).map((route) => `  <url><loc>${options.siteUrl}${route.id}</loc></url>`),
      "</urlset>",
      "",
    ].join("\n"));

    meeko.addHead({
      title: "Hello module",
      meta: [{ name: "generator", content: "meeko-module-hello" }],
      script: [{ children: "document.documentElement.dataset.helloHead = 'early'", key: "hello-early" }],
    });

    meeko.addVitePlugin({
      name: "hello:virtual-info",
      resolveId(id: string) { return id === "virtual:hello-info" ? "\0virtual:hello-info" : undefined; },
      load(id: string) { return id === "\0virtual:hello-info" ? 'export const info = "from-vite-plugin";' : undefined; },
    });
    meeko.extendViteConfig((config) => {
      config.define = { ...config.define, __HELLO_MARK__: JSON.stringify(options.mark) };
    });
  },
});
