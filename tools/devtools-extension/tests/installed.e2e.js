import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(extensionRoot));
const chromePath = process.env.MEEKO_CHROME_FOR_TESTING ?? chromium.executablePath();
let chromeAvailable = false;
try {
  await access(chromePath);
  chromeAvailable = true;
} catch {
  // Chrome for Testing es opcional para quien sólo ejecuta las pruebas unitarias.
}

/** Envía un comando CDP al contexto de la página de DevTools de la extensión. */
function extensionClient(browserSession, sessionId) {
  let nextId = 0;
  async function send(method, params) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        browserSession.off("Target.receivedMessageFromTarget", receive);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 10_000);
      function receive(packet) {
        if (packet.sessionId !== sessionId) return;
        const message = JSON.parse(packet.message);
        if (message.id !== id) return;
        clearTimeout(timeout);
        browserSession.off("Target.receivedMessageFromTarget", receive);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      }
      browserSession.on("Target.receivedMessageFromTarget", receive);
      browserSession.send("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({ id, method, params }),
      }).catch((error) => {
        clearTimeout(timeout);
        browserSession.off("Target.receivedMessageFromTarget", receive);
        reject(error);
      });
    });
  }
  return async (expression) => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result?.value;
  };
}

/** Usa exclusivamente la API real de Chrome DevTools para consultar la pestaña inspeccionada. */
async function inspectedWindow(evaluateExtension, expression) {
  const result = await evaluateExtension(`new Promise(resolve => chrome.devtools.inspectedWindow.eval(${JSON.stringify(expression)}, (value, exception) => resolve({value, exception})))`);
  assert.equal(result.exception, undefined, JSON.stringify(result.exception));
  return result.value;
}

test("la extensión instalada registra su panel y comunica con una app Meeko real", { skip: !chromeAvailable, timeout: 60_000 }, async () => {
  const server = await createServer({
    configFile: join(repositoryRoot, "examples/vite/vite.config.ts"),
    root: join(repositoryRoot, "examples/vite"),
    server: { host: "127.0.0.1", port: 0 },
  });
  let profile;
  let context;
  try {
    await server.listen();
    const address = server.httpServer?.address();
    assert.ok(address && typeof address !== "string");
    profile = await mkdtemp(join(tmpdir(), "meeko-extension-"));
    context = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath,
      headless: false,
      args: [
        `--disable-extensions-except=${extensionRoot}`,
        `--load-extension=${extensionRoot}`,
        "--auto-open-devtools-for-tabs",
      ],
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__MEEKO_DEVTOOLS__?.snapshot().instances.some((item) => item.name === "Counter"));

    const browserSession = await context.browser().newBrowserCDPSession();
    let extension;
    for (let attempt = 0; attempt < 50; attempt++) {
      const { targetInfos } = await browserSession.send("Target.getTargets");
      extension = targetInfos.find((item) => item.url.startsWith("chrome-extension://") && item.url.endsWith("/devtools.html"));
      if (extension) break;
      await page.waitForTimeout(100);
    }
    assert.ok(extension, "Chrome for Testing no cargó la página devtools.html de la extensión");
    const { sessionId } = await browserSession.send("Target.attachToTarget", { targetId: extension.targetId, flatten: false });
    const evaluateExtension = extensionClient(browserSession, sessionId);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluateExtension("document.documentElement.dataset.meekoPanelRegistered === 'true'")) break;
      await page.waitForTimeout(100);
    }
    assert.equal(await evaluateExtension("document.documentElement.dataset.meekoPanelRegistered"), "true", "El panel Meeko debe registrarse en DevTools");

    const initial = await inspectedWindow(evaluateExtension, "window.__MEEKO_DEVTOOLS__.snapshot()");
    const counter = initial.instances.find((item) => item.name === "Counter");
    assert.ok(counter, "La API real de Chrome debe transportar las instancias Meeko");
    assert.equal(await inspectedWindow(evaluateExtension, `(() => { const hook = window.__MEEKO_DEVTOOLS__; hook.select(${JSON.stringify(counter.id)}); return hook.snapshot().selectedId; })()`), counter.id);
    assert.equal(await inspectedWindow(evaluateExtension, `(() => { window.__MEEKO_DEVTOOLS__.highlight(${JSON.stringify(counter.id)}); return !!document.querySelector('[data-meeko-devtools-highlight]'); })()`), true);
    assert.equal(await inspectedWindow(evaluateExtension, "(() => { window.__MEEKO_DEVTOOLS__.highlight(null); return !!document.querySelector('[data-meeko-devtools-highlight]'); })()"), false);
    assert.equal(await inspectedWindow(evaluateExtension, `(() => { const hook = window.__MEEKO_DEVTOOLS__; hook.setBreakpoint(${JSON.stringify(counter.id)}, true); return hook.snapshot().instances.find(item => item.id === ${JSON.stringify(counter.id)}).breakpoint; })()`), true);
    await inspectedWindow(evaluateExtension, `window.__MEEKO_DEVTOOLS__.setBreakpoint(${JSON.stringify(counter.id)}, false)`);
    await page.locator("#app button").click();
    const updated = await inspectedWindow(evaluateExtension, "window.__MEEKO_DEVTOOLS__.snapshot()");
    assert.equal(updated.instances.find((item) => item.id === counter.id).signals.count, 3);
    assert.ok(updated.events.some((event) => event.kind === "signal" && event.instanceId === counter.id));
  } finally {
    await context?.close();
    await server.close();
    if (profile && dirname(profile) === tmpdir() && basename(profile).startsWith("meeko-extension-")) {
      await rm(profile, { recursive: true, force: true });
    }
  }
});
