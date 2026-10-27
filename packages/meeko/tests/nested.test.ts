import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { Window } from "happy-dom";
import { createServer } from "vite";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/sfc.ts";
import { meeko } from "../src/vite.ts";

interface NestedModule {
  renderToString(props: { initial: string }): string;
  hydrate(root: Element, props: { initial: string }): () => void;
}

async function loadParent(): Promise<{ server: Awaited<ReturnType<typeof createServer>>; component: NestedModule }> {
  const server = await createServer({ configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false } });
  const component = await server.ssrLoadModule(resolve("examples/nested/Parent.meeko")) as NestedModule;
  return { server, component };
}

test("componentes anidados e instancias hermanas hidratan sin colisionar marcadores", async () => {
  const { server, component } = await loadParent();
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({ initial: "Start" });
    const findButton = (label: string): HTMLButtonElement => {
      const button = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.startsWith(label));
      assert.ok(button, `Missing button ${label}; found ${[...root.querySelectorAll("button")].map((candidate) => candidate.textContent).join(" | ")}`);
      return button as unknown as HTMLButtonElement;
    };
    const first = findButton("Start:");
    const fixed = findButton("Fixed:");
    const firstEmphasis = root.querySelector("em");
    assert.equal(firstEmphasis?.textContent, "Start");
    const release = component.hydrate(root as unknown as Element, { initial: "Start" });
    const otherRoot = window.document.createElement("main");
    otherRoot.innerHTML = component.renderToString({ initial: "Other" });
    const releaseOther = component.hydrate(otherRoot as unknown as Element, { initial: "Other" });
    assert.equal(findButton("Start:"), first);
    assert.equal(findButton("Fixed:"), fixed);
    assert.equal(root.querySelector("em"), firstEmphasis);

    first.click();
    fixed.click();
    assert.equal(first.textContent?.trim(), "Start: 1");
    assert.equal(fixed.textContent?.trim(), "Fixed: 1");
    assert.equal(otherRoot.querySelector("button")?.textContent?.trim(), "Other: 0");
    findButton("Update").click();
    assert.equal(findButton("Updated:").textContent?.trim(), "Updated: 1");
    // New props update the mounted child in place: same button, same state.
    assert.equal(findButton("Updated:"), first);
    assert.equal(root.querySelector("em"), firstEmphasis);
    assert.equal(firstEmphasis?.textContent, "Updated");
    assert.equal(findButton("Fixed:"), fixed);
    assert.equal(fixed.textContent?.trim(), "Fixed: 1");

    const itemA = root.querySelector('[data-id="a"]');
    const itemB = root.querySelector('[data-id="b"]');
    assert.ok(itemA);
    assert.ok(itemB);
    findButton("Reverse").click();
    assert.deepEqual([...root.querySelectorAll("li")].map((item) => item.getAttribute("data-id")), ["b", "a"]);
    assert.equal(root.querySelector('[data-id="a"]'), itemA);
    assert.equal(root.querySelector('[data-id="b"]'), itemB);

    const conditional = findButton("Conditional:");
    findButton("Toggle").click();
    assert.equal(conditional.isConnected, false);
    conditional.click();
    findButton("Toggle").click();
    assert.equal(findButton("Conditional:").textContent?.trim(), "Conditional: 0");

    release();
    fixed.click();
    assert.equal(fixed.textContent?.trim(), "Fixed: 1");
    releaseOther();
  } finally {
    window.happyDOM.abort();
    await server.close();
  }
});

test("peticiones SSR concurrentes conservan props y estado por instancia", async () => {
  const { server, component } = await loadParent();
  const window = new Window();
  try {
    const html = await Promise.all(Array.from({ length: 24 }, async (_, index) => {
      await new Promise<void>((resolveReady) => setImmediate(resolveReady));
      return component.renderToString({ initial: `Request-${index}` });
    }));
    for (const [index, markup] of html.entries()) {
      const root = window.document.createElement("main");
      root.innerHTML = markup;
      assert.equal(root.querySelector("button")?.textContent?.trim(), `Request-${index}: 0`);
      assert.equal(root.querySelector("em")?.textContent, `Request-${index}`);
    }
  } finally {
    window.happyDOM.abort();
    await server.close();
  }
});

test("el estado SSR de un hijo anidado se transfiere sin depender del valor aleatorio del cliente", async () => {
  const server = await createServer({ configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false } });
  const component = await server.ssrLoadModule(resolve("examples/nested/VolatileParent.meeko")) as {
    renderWithState(props: { label: string }): { html: string; state: Record<string, unknown> };
    hydrate(root: Element, props: { label: string }, state?: Record<string, unknown>): () => void;
  };
  const window = new Window();
  try {
    const rendered = component.renderWithState({ label: "Nested" });
    assert.match(rendered.html, /meeko:component:0:%7B%22token%22%3A/);
    const root = window.document.createElement("main");
    root.innerHTML = rendered.html;
    const before = root.textContent;
    const release = component.hydrate(root as unknown as Element, { label: "Nested" }, rendered.state);
    assert.equal(root.textContent, before);
    release();
  } finally {
    window.happyDOM.abort();
    await server.close();
  }
});

test("la hidratación restaura texto dinámico vacío y enlaza el formulario", async () => {
  const server = await createServer({ configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false } });
  const component = await server.ssrLoadModule(resolve("tests/fixtures/EmptyText.meeko")) as {
    renderWithState(props: Record<string, never>): { html: string; state: Record<string, unknown> };
    hydrate(root: Element, props: Record<string, never>, state?: Record<string, unknown>): () => void;
  };
  const window = new Window();
  try {
    const rendered = component.renderWithState({});
    const root = window.document.createElement("main");
    root.innerHTML = rendered.html;
    assert.equal(root.querySelector("p")?.textContent, "");
    assert.equal(root.querySelector("aside")?.textContent?.trim(), "tail");
    const release = component.hydrate(root as unknown as Element, {}, rendered.state);
    const form = root.querySelector("form")!;
    const submit = new window.Event("submit", { bubbles: true, cancelable: true });
    assert.equal(form.dispatchEvent(submit), false);
    assert.equal(root.querySelector("p")?.textContent, "Saved");
    assert.equal(root.querySelector("aside")?.textContent, "Saved tail");
    release();
  } finally {
    window.happyDOM.abort();
    await server.close();
  }
});

test("la sintaxis de composición rechaza referencias, contenido y props no compatibles", () => {
  const script = `<script lang="ts">const Child = 1;</script>`;
  const cases = [
    { template: `<component bind:label="'x'"></component>`, code: "MEEK030" },
    { template: `<component is="Child"><span>nested</span></component>`, code: "MEEK031" },
    { template: `<component is="Child" data-label="x"></component>`, code: "MEEK032" },
  ];
  for (const { template, code } of cases) {
    const source = `${script}\n<template>${template}</template>`;
    assert.throws(() => compile(source, "BadChild.meeko"), (error: unknown) => {
      assert.ok(error instanceof MeekoCompileError);
      assert.equal(error.diagnostic.code, code);
      assert.equal(error.diagnostic.location.line, 2);
      return true;
    });
  }
});

test("un marcador hijo incompleto informa componente y posición de origen", async () => {
  const { server, component } = await loadParent();
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({ initial: "Start" }).replace("<!--/meeko:component:0-->", "");
    assert.throws(() => component.hydrate(root as unknown as Element, { initial: "Start" }), /Hydration mismatch in Parent\.meeko:\d+:\d+ \(component Child\)/);
  } finally {
    window.happyDOM.abort();
    await server.close();
  }
});
