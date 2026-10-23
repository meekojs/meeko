import assert from "node:assert/strict";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { mountDevtoolsPanel } from "../src/devtools-ui/index.ts";
import type { DevtoolsHook, DevtoolsSnapshot } from "../src/devtools.ts";

test("panel DevTools muestra ausencia del hook y se conecta cuando queda disponible", () => {
  const browser = new HappyWindow();
  const view = browser as unknown as Window;
  const document = view.document;
  const panel = mountDevtoolsPanel({ container: document.body });
  const host = document.querySelector("[data-meeko-devtools-panel]");
  assert.ok(host?.shadowRoot);
  const shadow = host.shadowRoot;
  assert.match(shadow.querySelector("[role=status]")?.textContent ?? "", /Hook no disponible/);

  const eventAt = Date.parse("2026-10-23T12:34:56Z");
  const snapshot: DevtoolsSnapshot = {
    selectedId: null,
    instances: [
      { id: "parent", componentId: "p", name: "Parent", file: "Parent.meeko", props: { label: "<script>" }, signals: { count: 2 }, parentId: null, childIds: ["child"], status: "hydrated", breakpoint: false },
      { id: "child", componentId: "c", name: "Child", file: "Child.meeko", props: {}, signals: {}, parentId: "parent", childIds: [], status: "hydrated", breakpoint: false },
    ],
    events: [
      { id: 1, at: eventAt, kind: "mount", instanceId: "parent", componentName: "Parent", file: "Parent.meeko" },
      { id: 2, at: eventAt, kind: "signal", instanceId: "parent", detail: "count", componentName: "Parent", file: "Parent.meeko", value: 2, reads: [{ file: "Parent.meeko", line: 8, column: 5, expression: "count.value", kind: "text" }] },
    ],
  };
  const listeners = new Set<() => void>();
  const highlighted: Array<string | null> = [];
  const hook: DevtoolsHook = {
    snapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    select(id) { snapshot.selectedId = id; for (const listener of listeners) listener(); },
    highlight(id) { highlighted.push(id); },
    setBreakpoint(id, enabled) {
      const instance = snapshot.instances.find((item) => item.id === id);
      if (instance) instance.breakpoint = enabled;
      for (const listener of listeners) listener();
    },
  };
  view.__MEEKO_DEVTOOLS__ = hook;
  view.dispatchEvent(new browser.Event("meeko:devtools-ready") as unknown as Event);
  assert.equal(listeners.size, 1);
  assert.equal(shadow.querySelector(".tree-children button")?.textContent, "Child");
  assert.equal(shadow.querySelectorAll("script").length, 0);
  const eventText = shadow.querySelector(".events ol > li:last-child")?.textContent ?? "";
  assert.ok(eventText.includes(new Date(eventAt).toLocaleTimeString("es", { hour12: false })));
  assert.match(eventText, /Montaje · parent/);
  assert.match(eventText, /Parent\.meeko/);
  assert.ok(!eventText.includes(String(eventAt)));
  const signalFilter = shadow.querySelector<HTMLInputElement>('.events input[type="checkbox"]');
  assert.ok(signalFilter);
  signalFilter.checked = true;
  signalFilter.dispatchEvent(new browser.Event("change") as unknown as Event);
  assert.equal(shadow.querySelectorAll(".events ol > li").length, 1);
  assert.match(shadow.querySelector(".events ol > li")?.textContent ?? "", /Señal · parent.*count → 2/);
  assert.match(shadow.querySelector(".events ol > li details")?.textContent ?? "", /Parent\.meeko:8:5.*count\.value/);
  shadow.querySelector<HTMLButtonElement>(".events ol > li button")?.click();
  assert.equal(snapshot.selectedId, "parent");

  const select = shadow.querySelector<HTMLButtonElement>('button[data-instance-id="parent"][data-action="select"]');
  assert.ok(select);
  select.click();
  assert.equal(snapshot.selectedId, "parent");
  assert.match(shadow.textContent ?? "", /<script>/);
  assert.equal(shadow.querySelector(".content")?.getAttribute("data-view"), "detail");
  const viewButtons = shadow.querySelectorAll<HTMLButtonElement>(".mobile-switch button");
  assert.equal(viewButtons[1]?.getAttribute("aria-pressed"), "true");
  viewButtons[0]?.click();
  assert.equal(shadow.querySelector(".content")?.getAttribute("data-view"), "instances");
  assert.equal(viewButtons[0]?.getAttribute("aria-pressed"), "true");
  viewButtons[1]?.click();
  assert.equal(shadow.querySelector(".content")?.getAttribute("data-view"), "detail");

  const breakpoint = shadow.querySelector<HTMLButtonElement>('button[data-action="breakpoint"]');
  assert.ok(breakpoint);
  breakpoint.click();
  assert.equal(snapshot.instances[0]?.breakpoint, true);
  assert.equal(shadow.querySelector('[data-action="breakpoint"]')?.getAttribute("aria-pressed"), "true");

  const highlight = shadow.querySelector<HTMLButtonElement>('button[data-action="highlight"]');
  assert.ok(highlight);
  highlight.click();
  assert.deepEqual(highlighted, ["parent"]);

  panel.unmount();
  assert.equal(listeners.size, 0);
  assert.equal(document.querySelector("[data-meeko-devtools-panel]"), null);
  assert.deepEqual(highlighted, ["parent", null]);
  view.dispatchEvent(new browser.Event("meeko:devtools-ready") as unknown as Event);
  assert.equal(listeners.size, 0);
  panel.unmount();
  browser.happyDOM.abort();
});
