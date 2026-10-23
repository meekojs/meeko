import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const chromePath = process.env.MEEKO_CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const files = new Map([
  ["/panel.html", ["panel.html", "text/html"]],
  ["/panel.js", ["panel.js", "text/javascript"]],
  ["/protocol.js", ["protocol.js", "text/javascript"]],
  ["/panel.css", ["panel.css", "text/css"]],
  ["/meeko-logo.png", ["meeko-logo.png", "image/png"]],
]);

/** Sirve únicamente los archivos del panel durante la prueba visual local. */
function servePanel() {
  return createServer(async (request, response) => {
    const entry = files.get(new URL(request.url ?? "/", "http://localhost").pathname);
    if (!entry) {
      response.writeHead(404).end();
      return;
    }
    try {
      response.writeHead(200, { "Content-Type": entry[1] });
      response.end(await readFile(join(root, entry[0])));
    } catch {
      response.writeHead(500).end();
    }
  });
}

let chromium;
try {
  await access(chromePath);
  ({ chromium } = await import("playwright-core"));
} catch {
  // Chrome y Playwright son opcionales para quien sólo comprueba el protocolo.
}

test("el panel permanece legible y sin desbordamiento horizontal en DevTools estrecho", { skip: !chromium }, async () => {
  const server = servePanel();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    for (const width of [360, 400, 420, 800]) {
      const page = await browser.newPage({ viewport: { width, height: 740 } });
      await page.addInitScript(() => {
        const instances = [
          { id: "meeko-1", componentId: "counter", name: "Counter", file: "/src/Counter.meeko", props: { caption: "Un valor largo para validar que las propiedades no ensanchan el panel" }, signals: { count: 1 }, parentId: null, childIds: ["meeko-2"], status: "mounted", breakpoint: false },
          { id: "meeko-2", componentId: "counter", name: "Counter", file: "/src/Counter.meeko", props: {}, signals: { count: 2 }, parentId: "meeko-1", childIds: [], status: "mounted", breakpoint: false },
        ];
        let selectedId = "meeko-1";
        window.__MEEKO_DEVTOOLS__ = {
          snapshot: () => ({ instances, selectedId, events: [{ id: 1, at: Date.now(), kind: "signal", instanceId: "meeko-1", detail: "NombreDeSeñalExtremadamenteLargoSinEspaciosParaProbarElAncho" }] }),
          select: (id) => { selectedId = id; },
          highlight: () => {},
          setBreakpoint: (id, enabled) => { const instance = instances.find((item) => item.id === id); if (instance) instance.breakpoint = enabled; },
        };
        Object.defineProperty(window, "chrome", {
          configurable: true,
          value: { devtools: { inspectedWindow: { eval: (expression, callback) => {
            try { callback(window.eval(expression)); } catch (error) { callback(undefined, { value: String(error) }); }
          } } } },
        });
      });
      await page.goto(`http://127.0.0.1:${address.port}/panel.html`);
      await page.locator(".instance-button").first().waitFor();
      assert.equal(await page.locator("#detail-name").textContent(), "Counter");
      assert.equal(await page.locator("#event-list li").count(), 1);
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        app: document.querySelector(".app")?.getBoundingClientRect().width,
        sidebar: document.querySelector(".sidebar")?.getBoundingClientRect().width,
        detail: document.querySelector(".detail")?.getBoundingClientRect().width,
      }));
      assert.ok(layout.document <= layout.viewport, `${width}px: desbordamiento ${JSON.stringify(layout)}`);
      assert.ok(layout.app === width && layout.sidebar > 0 && layout.detail > 0, `${width}px: panel ilegible ${JSON.stringify(layout)}`);
      await page.locator(".instance-button").first().focus();
      await page.keyboard.press("ArrowDown");
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-instance-id")), "meeko-2");
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});
