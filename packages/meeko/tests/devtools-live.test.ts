import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { compile } from "../src/compiler.ts";
import type { LiveBrowserResult, LiveBrowserUpdate, LiveServerMessage } from "../src/devtools-bridge-protocol.ts";
import { connectLiveBridge, disconnectLiveBridge, liveThrottleMs, liveValueLimit } from "../src/devtools-live.ts";
import type { LiveHotContext } from "../src/devtools-live.ts";
import { registerDevtoolsInstance } from "../src/devtools.ts";
import type { DevtoolsHook } from "../src/devtools.ts";
import { borrowedKey } from "../src/models.ts";
import { signal } from "../src/reactivity.ts";

/** `import.meta.hot` falso: guarda lo enviado y entrega mensajes del servidor a sus oyentes. */
function fakeHot(sent: Array<{ event: string; data: unknown }> = []): LiveHotContext & { sent: Array<{ event: string; data: unknown }>; deliver(message: LiveServerMessage): void } {
  const listeners: Array<(data: unknown) => void> = [];
  return {
    sent,
    send(event, data) { sent.push({ event, data }); },
    on(event, listener) { if (event === "meeko:live") listeners.push(listener); },
    deliver(message) { for (const listener of [...listeners]) listener(message); },
  };
}

function updates(hot: ReturnType<typeof fakeHot>): LiveBrowserUpdate[] {
  return hot.sent.filter((item) => item.event === "meeko:live:update").map((item) => item.data as LiveBrowserUpdate);
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function withBrowser<T>(run: (window: Window) => Promise<T>): Promise<T> {
  const browser = new Window();
  const names = ["window", "Node"] as const;
  const previous = names.map((name) => ({ name, value: Reflect.get(globalThis, name), present: Reflect.has(globalThis, name) }));
  Reflect.set(globalThis, "window", browser);
  Reflect.set(globalThis, "Node", browser.Node);
  try {
    return await run(browser);
  } finally {
    disconnectLiveBridge();
    for (const item of previous) {
      if (item.present) Reflect.set(globalThis, item.name, item.value);
      else Reflect.deleteProperty(globalThis, item.name);
    }
    browser.happyDOM.abort();
  }
}

test("sólo la compilación hot declara la ubicación de cada binding", () => {
  const source = `<script lang="ts">\nconst count = signal(1);\nconst label = "x";\nfunction bump() { count.value++; }\n</script><template><button on:click="bump">{count.value}{label}</button></template>`;
  const hot = compile(source, "/app/Probe.meeko", { hot: true }).code;
  assert.match(hot, /sites: \{ "count": \{ line: 2, column: 7 \}, "label": \{ line: 3, column: 7 \}, "bump": \{ line: 4, column: 10 \} \}/);
  assert.doesNotMatch(compile(source, "/app/Probe.meeko").code, /sites:|connectLiveBridge/);
});

test("el navegador no envía valores sin un editor suscrito", async () => {
  await withBrowser(async (browser) => {
    const count = signal(1);
    const release = registerDevtoolsInstance({ componentId: "c", name: "Counter", file: "/app/Counter.meeko", scope: { root: browser.document.createElement("div") as unknown as Element }, props: {}, bindings: { count }, sites: { count: { line: 2, column: 7 } } });
    const hot = fakeHot();
    connectLiveBridge(hot);
    assert.deepEqual(hot.sent, [{ event: "meeko:live:hello", data: {} }]);
    hot.deliver({ seq: 1, session: "s", type: "state", active: false });
    count.value = 2;
    count.value = 3;
    await wait(liveThrottleMs * 2);
    assert.deepEqual(updates(hot), []);
    release();
    await wait(liveThrottleMs * 2);
    assert.deepEqual(updates(hot), [], "Un desmontaje tampoco se envía sin suscriptor");
  });
});

test("al activarse el navegador envía su estado sin esperar y marca como alias los modelos prestados", async () => {
  await withBrowser(async (browser) => {
    const dialogOpen = signal(false);
    const scope = () => ({ root: browser.document.createElement("div") as unknown as Element });
    // defineModel hands each child the parent's signal itself and lists it under borrowedKey.
    const borrowing = (bindings: Record<string, unknown>, ...borrowed: unknown[]): Record<string, unknown> => {
      Reflect.set(bindings, borrowedKey, new Set(borrowed));
      return bindings;
    };
    const releaseOverlay = registerDevtoolsInstance({ componentId: "overlay", name: "Overlay", file: "/app/Overlay.meeko", scope: scope(), props: {}, bindings: borrowing({ open: dialogOpen }, dialogOpen), sites: { open: { line: 15, column: 8 } } });
    const releasePage = registerDevtoolsInstance({ componentId: "lab", name: "lab", file: "/app/pages/lab.meeko", scope: scope(), props: {}, bindings: { dialogOpen, count: signal(1) }, sites: { dialogOpen: { line: 24, column: 8 } } });
    const releaseModal = registerDevtoolsInstance({ componentId: "modal", name: "Modal", file: "/app/Modal.meeko", scope: scope(), props: {}, bindings: borrowing({ open: dialogOpen }, dialogOpen), sites: { open: { line: 13, column: 8 } } });
    const hook = Reflect.get(browser, "__MEEKO_DEVTOOLS__") as DevtoolsHook;
    const idOf = (name: string) => hook.snapshot().instances.find((instance) => instance.name === name)!.id;
    const hot = fakeHot();
    connectLiveBridge(hot);
    hot.deliver({ seq: 1, session: "s", type: "state", active: true });
    const [first] = updates(hot);
    assert.ok(first, "El estado sale en cuanto llega la activación, sin temporizador");
    const signalOf = (update: LiveBrowserUpdate, component: string, name: string) => update.signals.find((item) => item.component === component && item.name === name);
    const principal = { instanceId: idOf("lab"), component: "lab", file: "/app/pages/lab.meeko", name: "dialogOpen", line: 24, column: 8 };
    assert.equal(signalOf(first, "lab", "dialogOpen")?.alias, undefined, "La señal del padre es la principal, aunque el hijo se registrara antes");
    assert.equal(signalOf(first, "lab", "count")?.alias, undefined);
    assert.deepEqual(signalOf(first, "Modal", "open")?.alias, principal);
    assert.deepEqual(signalOf(first, "Overlay", "open")?.alias, principal, "Un modelo reenviado apunta a la señal original");
    assert.equal(signalOf(first, "Modal", "open")?.json, "false", "Cada alias conserva su valor");

    // Without the owner, the first instance that shares the signal becomes the principal.
    releasePage();
    hot.deliver({ seq: 2, session: "s", type: "state", active: true });
    const second = updates(hot).at(-1)!;
    assert.equal(signalOf(second, "Overlay", "open")?.alias, undefined);
    assert.deepEqual(signalOf(second, "Modal", "open")?.alias, { instanceId: idOf("Overlay"), component: "Overlay", file: "/app/Overlay.meeko", name: "open", line: 15, column: 8 });
    releaseModal();
    releaseOverlay();
  });
});

test("con un editor suscrito el navegador envía todo, limita la frecuencia y deja de enviar al desuscribirse", async () => {
  await withBrowser(async (browser) => {
    const count = signal(1);
    const big = signal("x".repeat(400));
    const root = browser.document.createElement("div") as unknown as Element;
    const release = registerDevtoolsInstance({ componentId: "c", name: "Counter", file: "/app/Counter.meeko", scope: { root }, props: {}, bindings: { count, big, label: "fixed" }, sites: { count: { line: 2, column: 7 }, big: { line: 3, column: 7 } } });
    const hot = fakeHot();
    // Two modules' hot contexts share one HMR socket, hence one log of sent events.
    const second = fakeHot(hot.sent);
    connectLiveBridge(hot);
    connectLiveBridge(second);
    assert.deepEqual(hot.sent.map((item) => item.event), ["meeko:live:hello"], "Sólo el primer contexto saluda al servidor");
    const subscribe: LiveServerMessage = { seq: 1, session: "s", type: "state", active: true };
    hot.deliver(subscribe);
    second.deliver(subscribe);
    await wait(liveThrottleMs);
    const [first] = updates(hot);
    assert.equal(updates(hot).length, 1, "Un mensaje repetido por varios contextos se procesa una vez");
    assert.ok(first);
    assert.equal(first.reset, true);
    const sent = first.signals.find((item) => item.name === "count");
    assert.deepEqual(sent, { instanceId: sent?.instanceId, component: "Counter", file: "/app/Counter.meeko", name: "count", line: 2, column: 7, json: "1", truncated: false });
    assert.equal(first.signals.some((item) => item.name === "label"), false, "Sólo se envían señales editables");

    // A change after a quiet interval goes out at once; the next ones wait for the interval.
    count.value = 2;
    for (let attempt = 0; attempt < 100 && updates(hot).length < 2; attempt++) await wait(5);
    assert.deepEqual(updates(hot)[1]?.signals.map((item) => [item.name, item.json]), [["count", "2"]]);
    for (let value = 3; value <= 7; value++) count.value = value;
    await wait(liveThrottleMs / 4);
    assert.equal(updates(hot).length, 2, "Los cambios seguidos esperan al intervalo");
    await wait(liveThrottleMs + 20);
    const throttled = updates(hot).slice(2);
    assert.equal(throttled.length, 1, "Cinco cambios seguidos salen en un solo envío");
    assert.deepEqual(throttled[0]?.signals.map((item) => [item.name, item.json]), [["count", "7"]]);

    big.value = "y".repeat(500);
    const nested = Array.from({ length: 50 }, () => "z".repeat(200));
    big.value = nested as unknown as string;
    await wait(liveThrottleMs + 20);
    const truncated = updates(hot).at(-1)?.signals.find((item) => item.name === "big");
    assert.equal(truncated?.truncated, true);
    assert.equal(truncated?.json.length, liveValueLimit);

    const hook = Reflect.get(browser, "__MEEKO_DEVTOOLS__") as DevtoolsHook;
    const instanceId = hook.snapshot().instances[0]!.id;
    hot.deliver({ seq: 2, session: "s", type: "setSignal", request: 7, instanceId, name: "count", value: 42 });
    second.deliver({ seq: 2, session: "s", type: "setSignal", request: 7, instanceId, name: "count", value: 42 });
    assert.equal(count.value, 42);
    const results = hot.sent.filter((item) => item.event === "meeko:live:result").map((item) => item.data as LiveBrowserResult);
    assert.deepEqual(results, [{ request: 7, result: { ok: true } }]);
    hot.deliver({ seq: 3, session: "s", type: "setSignal", request: 8, instanceId, name: "label", value: 1 });
    const rejected = hot.sent.filter((item) => item.event === "meeko:live:result").at(-1)?.data as LiveBrowserResult;
    assert.equal(rejected.result.ok, false);

    await wait(liveThrottleMs + 20);
    release();
    await wait(liveThrottleMs + 20);
    assert.deepEqual(updates(hot).at(-1)?.removed, [instanceId]);

    hot.deliver({ seq: 4, session: "s", type: "state", active: false });
    const count2 = signal(0);
    const before = hot.sent.length;
    const release2 = registerDevtoolsInstance({ componentId: "d", name: "Other", file: "/app/Other.meeko", scope: { root: browser.document.createElement("p") as unknown as Element }, props: {}, bindings: { count2 } });
    count2.value = 1;
    await wait(liveThrottleMs * 2);
    assert.equal(hot.sent.length, before, "Tras desuscribirse no se envía nada");
    release2();

    hot.deliver({ seq: 1, session: "restarted", type: "state", active: true });
    await wait(liveThrottleMs);
    assert.equal(updates(hot).at(-1)?.reset, true, "Una sesión nueva del servidor reinicia la secuencia");
  });
});
