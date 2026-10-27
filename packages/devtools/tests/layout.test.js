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
        const events = [{ id: 1, at: Date.now(), kind: "signal", instanceId: "meeko-1", detail: "NombreDeSeñalExtremadamenteLargoSinEspaciosParaProbarElAncho", componentName: "Counter", file: "/src/Counter.meeko", value: 2, reads: [{ file: "/src/Counter.meeko", line: 4, column: 10, expression: "count.value", kind: "text" }, { file: "/src/Counter.meeko", line: 5, column: 26, expression: "() => count.value * 2", kind: "computed" }], write: { kind: "assignment", file: "/src/Counter.meeko", line: 16, column: 41, expression: "count.value++" } }];
        window.__MEEKO_DEVTOOLS__ = {
          protocolVersion: 1,
          snapshot: () => JSON.parse(JSON.stringify({ protocolVersion: 1, instances, selectedId, events })),
          select: (id) => { selectedId = id; },
          highlight: () => {},
          setBreakpoint: (id, enabled) => { const instance = instances.find((item) => item.id === id); if (instance) instance.breakpoint = enabled; },
          setSignal: (id, name, value) => {
            const instance = instances.find((item) => item.id === id);
            if (!instance || !(name in instance.signals)) return { ok: false, error: "no writable signal" };
            instance.signals[name] = value;
            events.push({ id: events.length + 1, at: Date.now(), kind: "signal", instanceId: id, detail: name, componentName: "Counter", file: "/src/Counter.meeko", value, write: { kind: "devtools" } });
            return { ok: true };
          },
        };
        Object.defineProperty(window, "chrome", {
          configurable: true,
          value: { devtools: { inspectedWindow: { eval: (expression, callback) => {
            try { callback(window.eval(expression)); } catch (error) { callback(undefined, { value: String(error) }); }
          } } } },
        });
      });
      // The panel's readiness is the rendered instance list below, not the window load event,
      // which slow CI runners can delay past the navigation timeout.
      await page.goto(`http://127.0.0.1:${address.port}/panel.html`, { waitUntil: "domcontentloaded" });
      await page.locator(".instance-button").first().waitFor();
      assert.equal(await page.locator("#detail-name").textContent(), "Counter");
      assert.equal(await page.locator("#event-list > li").count(), 1);
      assert.match(await page.locator("#event-list > li").innerText(), /Counter.*Counter\.meeko.*→ 2/s);
      assert.match(await page.locator("#event-list .event-write").innerText(), /Escrita en \/src\/Counter\.meeko:16:41: count\.value\+\+/);
      await page.locator("#event-list details summary").click();
      assert.match(await page.locator("#event-list details").innerText(), /Counter\.meeko:4:10 texto: count\.value.*Counter\.meeko:5:26 computed: \(\) => count\.value \* 2/s);
      await page.locator("#signal-events").check();
      assert.equal(await page.locator("#event-list > li").count(), 1);

      assert.equal(await page.locator("#signal-editor").isVisible(), true);
      assert.equal(await page.locator("#edit-value").inputValue(), "1");
      await page.locator("#edit-value").fill("{ nope");
      await page.locator("#edit-apply").click();
      assert.match(await page.locator("#edit-message").innerText(), /JSON no válido/);
      assert.equal(await page.locator("#edit-message").getAttribute("role"), "alert");
      const messageBox = await page.evaluate(() => {
        const message = document.getElementById("edit-message")?.getBoundingClientRect();
        const detail = document.querySelector(".detail")?.getBoundingClientRect();
        return message && detail ? { top: message.top, bottom: message.bottom, detailTop: detail.top, detailBottom: detail.bottom } : null;
      });
      assert.ok(messageBox && messageBox.top >= messageBox.detailTop && messageBox.bottom <= messageBox.detailBottom, `${width}px: el error del editor queda fuera de la vista ${JSON.stringify(messageBox)}`);
      await page.locator("#edit-value").fill('{"total": 5}');
      await page.locator("#edit-apply").click();
      await page.locator("#edit-message", { hasText: "Señal count actualizada." }).waitFor();
      assert.match(await page.locator("#signals-value").innerText(), /"total": 5/);
      await page.locator("#event-list .event-write", { hasText: "Escrita desde DevTools" }).waitFor();
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
      // With the instance filter on, an instance without events shows the empty message across the row.
      await page.locator("#selected-events").check();
      await page.locator('.instance-button[data-instance-id="meeko-2"]').click();
      await page.locator("#event-list > li.list-empty", { hasText: "Sin eventos registrados." }).waitFor();
      const emptyBox = await page.evaluate(() => {
        const item = document.querySelector("#event-list > li.list-empty");
        const range = document.createRange();
        if (item) range.selectNodeContents(item);
        return { text: range.getBoundingClientRect().width, lines: range.getClientRects().length };
      });
      assert.ok(emptyBox.lines === 1 && emptyBox.text > 120, `${width}px: el mensaje vacío se parte en una columna estrecha ${JSON.stringify(emptyBox)}`);
      await page.close();
    }
    const legacy = await browser.newPage({ viewport: { width: 400, height: 740 } });
    await legacy.addInitScript(() => {
      window.__MEEKO_DEVTOOLS__ = { protocolVersion: 2, snapshot: () => ({ protocolVersion: 2, instances: [], events: [], selectedId: null }) };
      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: { devtools: { inspectedWindow: { eval: (expression, callback) => { callback(window.eval(expression)); } } } },
      });
    });
    await legacy.goto(`http://127.0.0.1:${address.port}/panel.html`);
    await legacy.locator("#connection", { hasText: "Protocolo no compatible" }).waitFor();
    assert.equal(await legacy.locator("#empty-title").innerText(), "Versión de protocolo no compatible");
    assert.match(await legacy.locator("#empty-description").innerText(), /protocolo DevTools 2 y esta extensión admite el 1/);
    await legacy.close();
  } finally {
    await browser.close();
    server.close();
  }
});
