import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window as HappyWindow } from "happy-dom";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { CompletionItem, MarkupContent } from "vscode-languageserver/node";
import { compile } from "../src/compiler.ts";
import { checkSource } from "../src/check.ts";
import { computePopoverPosition, listKeyTarget, normalizeText, placementArea, placementMargin, popoverPlacement, typeaheadIndex } from "../src/builtins/popover.ts";
import { defaultSelectFilter, groupOptions, sameOption, selectDisabled, selectLabel, selectValue, toggleSelection } from "../src/builtins/select.ts";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { completion, componentNameCompletion, directiveNameCompletion, hover } from "../src/language-server/features.ts";
import { createTempProject, linkRepositoryPackages } from "./helpers/temp-project.ts";
import { languageProject } from "./language-server-workspace.ts";

const runtimeUrl = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);

/** The compiled module of a component, with the runtime and the built-in tags from the sources. */
function runnable(code: string): string {
  return code
    .replace(`from "@meekojs/meeko/internal"`, `from ${runtimeUrl("src/internal.ts")}`)
    .replaceAll(`from "@meekojs/meeko"`, `from ${runtimeUrl("src/index.ts")}`)
    .replace(`from "@meekojs/meeko/builtins/popover"`, `from ${runtimeUrl("src/builtins/popover.compiled.ts")}`)
    .replace(`from "@meekojs/meeko/builtins/select"`, `from ${runtimeUrl("src/builtins/select.compiled.ts")}`);
}

interface Loaded {
  renderWithState(props: Record<string, never>): { html: string; state: Record<string, unknown> };
  hydrate(root: Element, props: Record<string, never>, state?: Record<string, unknown>): () => void;
}

async function load(source: string): Promise<{ module: Loaded; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "meeko-popover-"));
  await writeFile(join(directory, "Host.ts"), runnable(compile(source, join(directory, "Host.meeko")).code));
  const module = await import(pathToFileURL(join(directory, "Host.ts")).href) as Loaded;
  return { module, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

/**
 * The popover API on happy-dom, which lacks it: `showPopover`, `hidePopover`, `:popover-open`,
 * the `beforetoggle` and `toggle` events and the `popovertarget` buttons.
 */
function polyfillPopover(window: HappyWindow): void {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown> & HTMLElement;
  const flag = "data-meeko-popover-open";
  const fire = (element: HTMLElement, type: string, newState: string): void => {
    const event = new window.Event(type) as unknown as Event & { newState?: string };
    Object.defineProperty(event, "newState", { value: newState });
    element.dispatchEvent(event);
  };
  proto.showPopover = function (this: HTMLElement): void {
    if (this.hasAttribute(flag)) throw new Error("InvalidStateError: already open");
    fire(this, "beforetoggle", "open");
    this.setAttribute(flag, "");
    fire(this, "toggle", "open");
  };
  proto.hidePopover = function (this: HTMLElement): void {
    if (!this.hasAttribute(flag)) throw new Error("InvalidStateError: already closed");
    fire(this, "beforetoggle", "closed");
    this.removeAttribute(flag);
    fire(this, "toggle", "closed");
  };
  const matches = proto.matches as (this: Element, selector: string) => boolean;
  proto.matches = function (this: Element, selector: string): boolean {
    return selector === ":popover-open" ? this.hasAttribute(flag) : matches.call(this, selector);
  } as typeof proto.matches;
  window.document.addEventListener("click", (event) => {
    const invoker = (event.target as unknown as Element | null)?.closest?.("[popovertarget]");
    const target = invoker && window.document.getElementById(invoker.getAttribute("popovertarget")!);
    if (!target) return;
    const element = target as unknown as HTMLElement;
    if (element.hasAttribute(flag)) element.hidePopover();
    else element.showPopover();
  });
}

/** An event that both the DOM types and happy-dom's elements accept. */
type AnyEvent = Event & Parameters<HappyWindow["document"]["dispatchEvent"]>[0];

/** A keyboard event of happy-dom, cancelable and bubbling. */
const key = (window: HappyWindow, type: "keydown" | "keyup", name: string, init: { altKey?: boolean; shiftKey?: boolean } = {}): AnyEvent =>
  new window.KeyboardEvent(type, { key: name, bubbles: true, cancelable: true, ...init }) as unknown as AnyEvent;

const host = `<script lang="ts">
import { signal } from "@meekojs/meeko";
interface User { id: number; name: string; team: string; disabled?: boolean }
const color = signal<string | null>(null);
const colors = ["Rojo", "Verde", "Azul", "Ámbar"];
const users = signal<User[]>([{ id: 1, name: "Ana", team: "A" }, { id: 2, name: "Bea", team: "B", disabled: true }, { id: 3, name: "Carla", team: "A" }]);
const user = signal<User | null>({ id: 3, name: "Carla", team: "A" });
const tags = signal<string[]>(["Verde"]);
const menuOpen = signal(false);
const picked = signal("");
const toggles = signal<string[]>([]);
</script>
<template><main><MeekoPopover role="menu" model="menuOpen" on:toggle="(event) => toggles.value = [...toggles.value, String(event.open)]"><snippet name="trigger">Opciones</snippet><button role="menuitem" on:click="() => picked.value = 'renombrar'">Renombrar</button><button role="menuitem" disabled>Mover</button><button role="menuitem" on:click="() => picked.value = 'eliminar'">Eliminar</button></MeekoPopover><form id="form"><MeekoSelect id="color" model="color" bind:options="colors" name="color" placeholder="Elige un color" required /><MeekoSelect id="user" model="user" bind:options="users.value" by="id" groupBy="team" name="user"><snippet name="option" params="u, state">{u.name}{state.selected ? " ✓" : ""}</snippet><snippet name="value" params="u">{u.name}</snippet></MeekoSelect><MeekoSelect id="tags" model="tags" multiple searchable bind:options="colors" bind:max="2" name="tags" /></form><output id="state">{JSON.stringify({ color: color.value, user: user.value?.id ?? null, tags: tags.value, picked: picked.value, toggles: toggles.value, menu: menuOpen.value })}</output></main></template>`;

test("the compiled component imports <MeekoPopover> and <MeekoSelect> only when its template uses them", () => {
  const plain = compile("<template><p>Hola</p></template>", "/project/app/components/Plain.meeko").code;
  assert.doesNotMatch(plain, /builtins\//);
  const popover = compile('<template><MeekoPopover><snippet name="trigger">Más</snippet><p>x</p></MeekoPopover></template>', "/project/app/components/Menu.meeko").code;
  assert.match(popover, /^import \* as __meeko_MeekoPopover from "@meekojs\/meeko\/builtins\/popover";$/m);
  assert.doesNotMatch(popover, /builtins\/select/);
  assert.match(popover, /__meeko\.renderComponent<any>\(\d+, __meeko_MeekoPopover, /);
  // Its module counts among the children that a navigation may need to load.
  assert.match(popover, /__meekoChildren[^\n]*= \(\) => \[__meeko_MeekoPopover\]/);
  const select = compile('<template><MeekoSelect model="value" bind:options="list" /><MeekoSelect model="value" bind:options="list" /></template>', "/project/app/components/Pick.meeko").code;
  assert.equal(select.match(/import \* as __meeko_MeekoSelect from "@meekojs\/meeko\/builtins\/select";/g)?.length, 1, "one import for every use");
  // A component of the project with the tag's name wins, with MEEK106 and without the import.
  const shadowed = compile("<template><MeekoSelect /></template>", "/project/app/components/Pick.meeko", { projectComponents: ["MeekoSelect"] });
  assert.doesNotMatch(shadowed.code, /builtins\/select/);
  assert.deepEqual(shadowed.warnings?.map((warning) => warning.code), ["MEEK106"]);
  assert.match(shadowed.warnings![0]!.message, /select accesible/);
});

test("a custom trigger receives the attributes in the anchor snippet, and a tooltip describes its trigger", { timeout: 60_000 }, async () => {
  const source = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const open = signal(false);
</script>
<template><MeekoPopover role="dialog" label="Filtros" model="open" triggerId="filters"><snippet name="anchor" params="trigger"><button type="button" class="mine" bind:id="trigger.id" bind:popovertarget="trigger.popovertarget" bind:aria-controls="trigger['aria-controls']" bind:aria-expanded="trigger['aria-expanded']" bind:aria-haspopup="trigger['aria-haspopup']">Filtrar</button></snippet><input id="first"></MeekoPopover><MeekoPopover mode="hint"><snippet name="trigger">?</snippet>Ayuda</MeekoPopover><button id="open" on:click="() => open.value = true">abrir</button></template>`;
  const { module, cleanup } = await load(source);
  const browser = new HappyWindow({ url: "https://example.test/" });
  polyfillPopover(browser);
  try {
    const { html, state } = module.renderWithState({});
    const bare = html.replace(/<!--\/?meeko:[^>]*-->/g, "");
    assert.match(bare, /<button type="button" class="mine" id="filters" popovertarget="(m-[\w-]+-content)" aria-controls="\1" aria-expanded="false" aria-haspopup="dialog"[^>]*>Filtrar<\/button>/);
    assert.match(bare, /popover="auto" role="dialog" aria-label="Filtros" tabindex="-1"/);
    assert.doesNotMatch(bare, /data-meeko-popover-trigger="" id="filters"/, "no button of Meeko's own");
    assert.match(bare, /<button type="button" data-meeko-popover-trigger="" id="(m-[\w-]+)-trigger" aria-describedby="\1-content"[^>]*>\?<\/button><div data-meeko-popover="" id="\1-content" popover="hint" role="tooltip"/);
    const root = browser.document.createElement("div");
    browser.document.body.appendChild(root);
    root.innerHTML = html;
    const release = module.hydrate(root as unknown as Element, {}, state);
    // The model opens the dialog, which takes the focus; Escape on it gives the focus to the custom trigger.
    (root.querySelector("#open") as unknown as HTMLButtonElement).click();
    await new Promise((done) => setTimeout(done, 0));
    const mine = root.querySelector("#filters")!;
    assert.equal(mine.getAttribute("aria-expanded"), "true");
    assert.equal(browser.document.activeElement?.id, "first");
    browser.document.activeElement!.dispatchEvent(key(browser, "keydown", "Escape"));
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(mine.getAttribute("aria-expanded"), "false");
    assert.equal(browser.document.activeElement, mine);
    release();
  } finally {
    await browser.happyDOM.close();
    await cleanup();
  }
});

test("placements map to CSS anchor positioning and the fallback flips and stays in the viewport", () => {
  assert.equal(placementArea("bottom-start"), "bottom span-right");
  assert.equal(placementArea("top-end"), "top span-left");
  assert.equal(placementArea("right"), "right");
  assert.equal(placementArea("left-start"), "left span-bottom");
  assert.equal(popoverPlacement("sideways"), "bottom-start");
  assert.equal(placementMargin("bottom-end", 8), "8px 0px 0px 0px");
  assert.equal(placementMargin("top", 4), "0px 0px 4px 0px");
  assert.equal(placementMargin("left", 2), "0px 2px 0px 0px");
  assert.equal(placementMargin("right", -1), "0px 0px 0px 0px");
  const viewport = { width: 800, height: 600 };
  const size = { width: 200, height: 100 };
  // Below, aligned with the start edge of the trigger.
  assert.deepEqual(computePopoverPosition({ left: 100, top: 100, width: 80, height: 30 }, size, viewport, "bottom-start", 8), { x: 100, y: 138, side: "bottom" });
  assert.deepEqual(computePopoverPosition({ left: 100, top: 100, width: 80, height: 30 }, size, viewport, "bottom-end", 0), { x: 0, y: 130, side: "bottom" });
  // No room below: it opens above.
  assert.deepEqual(computePopoverPosition({ left: 100, top: 540, width: 80, height: 30 }, size, viewport, "bottom-start", 8), { x: 100, y: 432, side: "top" });
  // Neither side has room: it keeps the side with more space, inside the viewport.
  assert.equal(computePopoverPosition({ left: 0, top: 250, width: 10, height: 10 }, { width: 50, height: 400 }, viewport, "bottom", 0).y, 200);
  // Right, flipped to the left near the edge, and centered on the trigger.
  assert.deepEqual(computePopoverPosition({ left: 700, top: 200, width: 50, height: 20 }, size, viewport, "right", 4), { x: 496, y: 160, side: "left" });
});

test("menu keys and typeahead skip disabled items, ignore accents and cycle a repeated letter", () => {
  const skip = (index: number): boolean => index === 1;
  assert.equal(listKeyTarget("ArrowDown", 0, 3, skip), 2);
  assert.equal(listKeyTarget("ArrowDown", 2, 3, skip), 0, "it wraps");
  assert.equal(listKeyTarget("ArrowDown", 2, 3, skip, false), 2, "or not");
  assert.equal(listKeyTarget("ArrowUp", -1, 3), 2);
  assert.equal(listKeyTarget("Home", 2, 3, (index) => index === 0), 1);
  assert.equal(listKeyTarget("End", 0, 3, (index) => index === 2), 1);
  assert.equal(listKeyTarget("PageDown", 0, 30), 10);
  assert.equal(listKeyTarget("PageUp", 5, 30), 0);
  assert.equal(listKeyTarget("x", 0, 3), undefined);
  const labels = ["Rojo", "Verde", "Azul", "Ámbar", "Rosa"];
  assert.equal(normalizeText("Ámbar Ñandú"), "ambar nandu");
  assert.equal(typeaheadIndex(labels, "a", 0), 2);
  assert.equal(typeaheadIndex(labels, "a", 2), 3, "the same letter again goes to the next");
  assert.equal(typeaheadIndex(labels, "aa", 3), 2, "a repeated letter cycles");
  assert.equal(typeaheadIndex(labels, "ro", 0), 0, "a longer prefix keeps the current item");
  assert.equal(typeaheadIndex(labels, "ros", 0), 4);
  assert.equal(typeaheadIndex(labels, "r", -1, (index) => index === 0), 4);
  assert.equal(typeaheadIndex(labels, "z", 0), -1);
});

test("select helpers compare with by, label, group, filter without accents and respect max", () => {
  interface User { id: number; name: string; team?: string; disabled?: boolean; label?: string }
  const ana: User = { id: 1, name: "Ana", team: "A" };
  assert.equal(selectLabel("x"), "x");
  assert.equal(selectLabel(ana), "Ana");
  assert.equal(selectLabel({ id: 1, name: "n", label: "L" }), "L");
  assert.equal(selectLabel(ana, "team"), "A");
  assert.equal(selectLabel(ana, (user) => user.name.toUpperCase()), "ANA");
  assert.ok(sameOption(ana, { id: 1, name: "Otra" }, "id"));
  assert.ok(!sameOption(ana, { id: 1, name: "Ana" }), "without by, identity");
  assert.ok(sameOption(ana, { id: 9, name: "Ana" }, (a, b) => a.name === b.name));
  assert.equal(selectValue(ana, { by: "id" }), "1");
  assert.equal(selectValue(2, {}), "2");
  assert.equal(selectValue(ana, {}), "Ana");
  assert.ok(selectDisabled({ id: 2, name: "B", disabled: true }));
  assert.ok(!selectDisabled(ana));
  assert.ok(selectDisabled(ana, (user) => user.id === 1));
  assert.deepEqual(defaultSelectFilter(["Rojo", "Ámbar", "Verde"], " AMB ", String), ["Ámbar"]);
  const groups = groupOptions([ana, { id: 2, name: "Bea", team: "B", disabled: true }, { id: 3, name: "Carla", team: "A" }, { id: 4, name: "Sin" }], { groupBy: "team" }, "list");
  assert.deepEqual(groups.map((group) => [group.name, group.id, group.entries.map((entry) => [entry.index, entry.id, entry.label, entry.disabled])]), [
    ["A", "list-g0", [[0, "list-0", "Ana", false], [1, "list-1", "Carla", false]]],
    ["B", "list-g1", [[2, "list-2", "Bea", true]]],
    [undefined, undefined, [[3, "list-3", "Sin", false]]],
  ]);
  assert.deepEqual(toggleSelection(["a"], "b", { multiple: false }), ["b"]);
  assert.equal(toggleSelection(["a"], "a", { multiple: false }), undefined);
  assert.deepEqual(toggleSelection(["a"], "b", { multiple: true }), ["a", "b"]);
  assert.deepEqual(toggleSelection(["a", "b"], "a", { multiple: true }), ["b"]);
  assert.equal(toggleSelection(["a", "b"], "c", { multiple: true, max: 2 }), undefined, "max reached");
  assert.deepEqual(toggleSelection([ana], { id: 1, name: "copia" }, { multiple: true, by: "id" }), []);
});

test("SSR renders the trigger with its value and the list hidden by popover, and hydration keeps every ID", { timeout: 60_000 }, async () => {
  const { module, cleanup } = await load(host);
  const browser = new HappyWindow({ url: "https://example.test/" });
  polyfillPopover(browser);
  try {
    const first = module.renderWithState({});
    assert.equal(module.renderWithState({}).html, first.html, "the render is deterministic");
    const html = first.html.replace(/<!--\/?meeko:[^>]*-->/g, "");
    // The menu button and its content, hidden from the first byte by the popover attribute.
    assert.match(html, /<button type="button" data-meeko-popover-trigger="" id="(m-[\w-]+)-trigger" popovertarget="\1-content" aria-controls="\1-content" aria-expanded="false" aria-haspopup="menu"/);
    assert.match(html, /<div data-meeko-popover="" id="m-[\w-]+-content" popover="auto" role="menu" aria-labelledby="m-[\w-]+-trigger" data-placement="bottom-start"/);
    // The select shows its value or its placeholder before JavaScript, and the list is rendered.
    assert.match(html, /<button type="button" role="combobox" data-meeko-select-trigger="" id="color" aria-haspopup="listbox" aria-controls="(m-[\w-]+-listbox)" aria-expanded="false" aria-required="true"[^>]*><span data-meeko-select-placeholder="">Elige un color<\/span><\/button>/);
    assert.match(html, /<span data-meeko-select-value="">Carla<\/span>/);
    assert.match(html, /role="option" id="m-[\w-]+-listbox-1" data-index="1" aria-selected="true" data-selected=""[^>]*>Carla ✓<\/div>/);
    assert.match(html, /role="option" id="m-[\w-]+-listbox-2" data-index="2" aria-selected="false" aria-disabled="true" data-disabled=""[^>]*>Bea<\/div>/);
    assert.match(html, /<div role="group" aria-labelledby="(m-[\w-]+-listbox-g0)" data-meeko-select-group=""[^>]*><div role="presentation" id="\1" data-meeko-select-group-label=""[^>]*>A<\/div>/);
    assert.match(html, /<input type="text" role="combobox" autocomplete="off" aria-autocomplete="list" aria-haspopup="listbox" data-meeko-select-trigger="" id="tags"/);
    assert.match(html, /<div role="listbox" data-meeko-select-list="" id="m-[\w-]+-listbox" aria-multiselectable="true"/);
    assert.match(html, /<input type="hidden" name="color" value=""[^>]*><input type="text" hidden="" required="" tabindex="-1" aria-hidden="true" data-meeko-select-validity="" value=""/);
    assert.match(html, /<input type="hidden" name="user" value="3"/);
    assert.match(html, /<input type="hidden" name="tags" value="Verde"/);
    assert.doesNotMatch(html, /style=/, "no inline style: a strict CSP needs none");

    const root = browser.document.createElement("div");
    browser.document.body.appendChild(root);
    root.innerHTML = first.html;
    const ids = [...root.querySelectorAll("[id]")].map((node) => node.getAttribute("id"));
    assert.equal(new Set(ids).size, ids.length, "IDs are unique");
    const changes: string[] = [];
    const observer = new browser.MutationObserver((records) => {
      // Elements only: a snippet's empty text binding gets its text node when it hydrates.
      for (const record of records) {
        for (const node of [...record.addedNodes, ...record.removedNodes]) if (node.nodeType === 1) changes.push(`${record.type === "childList" ? "element" : record.type} ${(node as unknown as Element).outerHTML.slice(0, 80)}`);
      }
    });
    observer.observe(root, { subtree: true, childList: true });
    const release = module.hydrate(root as unknown as Element, {}, first.state);
    await new Promise((done) => setTimeout(done, 0));
    observer.disconnect();
    assert.deepEqual(changes, [], "hydration adds and removes no node");
    assert.deepEqual([...root.querySelectorAll("[id]")].map((node) => node.getAttribute("id")), ids);
    release();
  } finally {
    await browser.happyDOM.close();
    await cleanup();
  }
});

test("a select works with the keyboard and the pointer: single, by and groups, multiple with search and max, hidden inputs", { timeout: 60_000 }, async () => {
  const { module, cleanup } = await load(host);
  const browser = new HappyWindow({ url: "https://example.test/" });
  polyfillPopover(browser);
  try {
    const { html, state } = module.renderWithState({});
    const root = browser.document.createElement("div");
    browser.document.body.appendChild(root);
    root.innerHTML = html;
    const release = module.hydrate(root as unknown as Element, {}, state);
    const $ = <E extends Element = HTMLElement>(selector: string): E => root.querySelector(selector) as unknown as E;
    const result = (): { color: string | null; user: number | null; tags: string[]; picked: string; toggles: string[]; menu: boolean } => JSON.parse($("#state").textContent!);
    const press = (target: Element, name: string, init: { altKey?: boolean } = {}): void => {
      target.dispatchEvent(key(browser, "keydown", name, init));
      target.dispatchEvent(key(browser, "keyup", name, init));
    };
    const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

    // Single: the arrows open the list on the first option; the keys move the active option.
    const color = $("#color");
    const colorRoot = color.closest("[data-meeko-select]")!;
    const list = $<HTMLElement>(`#${color.getAttribute("aria-controls")}`);
    color.focus();
    press(color, "ArrowDown");
    await tick();
    assert.equal(color.getAttribute("aria-expanded"), "true");
    assert.ok(colorRoot.hasAttribute("data-open"));
    assert.ok(list.closest("[data-meeko-popover]")!.hasAttribute("data-meeko-popover-open"), "the popover opened");
    const active = (): string => browser.document.getElementById(color.getAttribute("aria-activedescendant")!)?.textContent ?? "";
    assert.equal(active(), "Rojo");
    press(color, "ArrowDown");
    assert.equal(active(), "Verde");
    assert.ok(list.querySelector("[data-active]")!.textContent === "Verde", "data-active marks it");
    press(color, "End");
    assert.equal(active(), "Ámbar");
    press(color, "Home");
    assert.equal(active(), "Rojo");
    press(color, "a");
    assert.equal(active(), "Azul");
    press(color, "a");
    assert.equal(active(), "Ámbar", "typeahead without accents");
    press(color, "Enter");
    await tick();
    assert.equal(result().color, "Ámbar");
    assert.equal(color.getAttribute("aria-expanded"), "false");
    assert.equal(color.getAttribute("aria-activedescendant"), null);
    assert.equal(color.textContent, "Ámbar");
    assert.equal(browser.document.activeElement, color, "the focus never left the trigger");
    assert.equal($<HTMLInputElement>("input[name=color]").value, "Ámbar");
    assert.equal($<HTMLInputElement>("[data-meeko-select-validity]").value, "selected");
    // Escape closes without changing the value; a click toggles.
    color.click();
    await tick();
    assert.equal(color.getAttribute("aria-expanded"), "true");
    assert.equal(active(), "Ámbar", "it opens on the chosen option");
    press(color, "Escape");
    assert.equal(color.getAttribute("aria-expanded"), "false");
    assert.equal(result().color, "Ámbar");

    // by="id": another object with id 3 is the chosen one; groups; a disabled option is skipped.
    const user = $("#user");
    assert.equal(user.textContent, "Carla");
    user.focus();
    press(user, "ArrowDown");
    const userActive = (): string => browser.document.getElementById(user.getAttribute("aria-activedescendant")!)?.textContent ?? "";
    assert.equal(userActive(), "Carla ✓");
    press(user, "ArrowDown");
    assert.equal(userActive(), "Carla ✓", "Bea is disabled and the list does not wrap");
    const userList = browser.document.getElementById(user.getAttribute("aria-controls")!)!;
    (userList.querySelector("[data-index='2']") as unknown as HTMLElement).click();
    assert.equal(result().user, 3, "a click on a disabled option does nothing");
    (userList.querySelector("[data-index='0']") as unknown as HTMLElement).click();
    await tick();
    assert.equal(result().user, 1);
    assert.equal(user.getAttribute("aria-expanded"), "false");
    assert.equal(user.textContent, "Ana");
    assert.equal($<HTMLInputElement>("input[name=user]").value, "1");

    // Multiple and searchable: the input filters without accents, Enter toggles and the list stays open.
    const tags = $<HTMLInputElement>("#tags");
    const tagsList = browser.document.getElementById(tags.getAttribute("aria-controls")!)!;
    tags.focus();
    tags.value = "amb";
    tags.dispatchEvent(new browser.Event("input", { bubbles: true }) as unknown as AnyEvent);
    await tick();
    assert.equal(tags.getAttribute("aria-expanded"), "true");
    assert.deepEqual([...tagsList.querySelectorAll("[role=option]")].map((option) => option.textContent), ["Ámbar"]);
    press(tags, "Enter");
    await tick();
    assert.deepEqual(result().tags, ["Verde", "Ámbar"]);
    assert.equal(tags.getAttribute("aria-expanded"), "true", "a multiple select stays open");
    assert.equal(tags.value, "", "the search is cleared");
    assert.deepEqual([...root.querySelectorAll("input[name=tags]")].map((input) => (input as unknown as HTMLInputElement).value), ["Verde", "Ámbar"]);
    // max=2: the other options cannot be chosen; a chosen one can be removed.
    const option = (label: string): HTMLElement => [...tagsList.querySelectorAll("[role=option]")].find((node) => node.textContent === label) as unknown as HTMLElement;
    assert.equal(option("Rojo").getAttribute("aria-disabled"), "true");
    assert.equal(option("Verde").getAttribute("aria-disabled"), null);
    option("Rojo").click();
    assert.deepEqual(result().tags, ["Verde", "Ámbar"]);
    option("Verde").click();
    await tick();
    assert.deepEqual(result().tags, ["Ámbar"]);
    assert.equal(option("Rojo").getAttribute("aria-disabled"), null);
    // A press outside the component closes it.
    browser.document.body.dispatchEvent(new browser.PointerEvent("pointerdown", { bubbles: true }) as unknown as AnyEvent);
    await tick();
    assert.equal(tags.getAttribute("aria-expanded"), "false");

    // The form submits one hidden input per value.
    const form = $<HTMLFormElement>("#form");
    const data = new browser.FormData(form as never);
    assert.deepEqual([...data.entries()].filter(([name]) => name !== ""), [["color", "Ámbar"], ["user", "1"], ["tags", "Ámbar"]]);
    release();
  } finally {
    await browser.happyDOM.close();
    await cleanup();
  }
});

test("a menu opens on its first item, moves with the arrows and letters, closes on a choice or Escape and gives the focus back", { timeout: 60_000 }, async () => {
  const { module, cleanup } = await load(host);
  const browser = new HappyWindow({ url: "https://example.test/" });
  polyfillPopover(browser);
  try {
    const { html, state } = module.renderWithState({});
    const root = browser.document.createElement("div");
    browser.document.body.appendChild(root);
    root.innerHTML = html;
    const release = module.hydrate(root as unknown as Element, {}, state);
    const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
    const result = (): { picked: string; toggles: string[]; menu: boolean } => JSON.parse(root.querySelector("#state")!.textContent!);
    const trigger = root.querySelector("[data-meeko-popover-trigger]") as unknown as HTMLButtonElement;
    const content = browser.document.getElementById(trigger.getAttribute("aria-controls")!)!;
    const focused = (): string => browser.document.activeElement?.textContent ?? "";
    trigger.focus();
    trigger.click();
    await tick();
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.ok(content.hasAttribute("data-open"));
    assert.equal(result().menu, true, "the model follows the popover");
    assert.equal(focused(), "Renombrar", "the first item takes the focus");
    content.dispatchEvent(key(browser, "keydown", "ArrowDown"));
    assert.equal(focused(), "Eliminar", "the disabled item is skipped");
    content.dispatchEvent(key(browser, "keydown", "ArrowDown"));
    assert.equal(focused(), "Renombrar", "the arrows wrap");
    content.dispatchEvent(key(browser, "keydown", "End"));
    assert.equal(focused(), "Eliminar");
    content.dispatchEvent(key(browser, "keydown", "r"));
    assert.equal(focused(), "Renombrar");
    (browser.document.activeElement as unknown as HTMLElement).click();
    await tick();
    assert.equal(result().picked, "renombrar");
    assert.equal(trigger.getAttribute("aria-expanded"), "false", "choosing an item closes the menu");
    assert.equal(browser.document.activeElement, trigger, "and the focus goes back to the trigger");
    // The arrow on the trigger opens it on the last item with ArrowUp; Escape closes it.
    trigger.dispatchEvent(key(browser, "keydown", "ArrowUp"));
    await tick();
    assert.equal(focused(), "Eliminar");
    content.dispatchEvent(key(browser, "keydown", "Escape"));
    await tick();
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(browser.document.activeElement, trigger);
    assert.deepEqual(result().toggles, ["true", "false", "true", "false"], "on:toggle emits { open } on each change");
    release();
  } finally {
    await browser.happyDOM.close();
    await cleanup();
  }
});

test("an async filter shows the loading state, aborts the previous search and shows the results", { timeout: 60_000 }, async () => {
  const source = `<script lang="ts">
import { signal } from "@meekojs/meeko";
interface City { code: string; name: string }
const city = signal<City | null>(null);
const searches: Array<{ query: string; signal: AbortSignal; resolve: (cities: City[]) => void }> = [];
(globalThis as { __searches?: unknown }).__searches = searches;
function search(query: string, context: { signal: AbortSignal }): Promise<City[]> {
  return new Promise((resolve) => { searches.push({ query, signal: context.signal, resolve }); });
}
</script>
<template><MeekoSelect id="city" model="city" bind:options="[]" by="code" searchable bind:filter="search" name="city"><snippet name="loading">Buscando…</snippet><snippet name="empty">Ninguna</snippet></MeekoSelect><output id="state">{city.value?.code ?? ""}</output></template>`;
  const { module, cleanup } = await load(source);
  const browser = new HappyWindow({ url: "https://example.test/" });
  polyfillPopover(browser);
  try {
    const { html, state } = module.renderWithState({});
    assert.match(html, /data-meeko-select-empty/, "an empty list says so");
    const root = browser.document.createElement("div");
    browser.document.body.appendChild(root);
    root.innerHTML = html;
    const release = module.hydrate(root as unknown as Element, {}, state);
    const searches = (globalThis as { __searches?: Array<{ query: string; signal: AbortSignal; resolve: (cities: Array<{ code: string; name: string }>) => void }> }).__searches!;
    const input = root.querySelector("#city") as unknown as HTMLInputElement;
    const select = root.querySelector("[data-meeko-select]")!;
    const list = browser.document.getElementById(input.getAttribute("aria-controls")!)!;
    const type = (text: string): void => {
      input.value = text;
      input.dispatchEvent(new browser.Event("input", { bubbles: true }) as unknown as AnyEvent);
    };
    const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
    input.focus();
    type("ma");
    await tick();
    assert.ok(select.hasAttribute("data-loading"));
    assert.equal(list.getAttribute("aria-busy"), "true");
    assert.match(list.textContent ?? "", /Buscando…/);
    type("mad");
    await tick();
    assert.deepEqual(searches.map((entry) => [entry.query, entry.signal.aborted]), [["ma", true], ["mad", false]]);
    // A late answer of the aborted search is ignored.
    searches[0]!.resolve([{ code: "MAL", name: "Málaga" }]);
    searches[1]!.resolve([{ code: "MAD", name: "Madrid" }]);
    await tick();
    assert.ok(!select.hasAttribute("data-loading"));
    assert.deepEqual([...list.querySelectorAll("[role=option]")].map((option) => option.textContent), ["Madrid"]);
    input.dispatchEvent(key(browser, "keydown", "Enter"));
    await tick();
    assert.equal(root.querySelector("#state")!.textContent, "MAD");
    assert.equal(input.value, "Madrid", "the input shows the chosen option");
    assert.equal((root.querySelector("input[name=city]") as unknown as HTMLInputElement).value, "MAD");
    release();
  } finally {
    delete (globalThis as { __searches?: unknown }).__searches;
    await browser.happyDOM.close();
    await cleanup();
  }
});

test("meeko check types the model, by and the snippets from the options, and multiple as an array", { timeout: 180_000 }, async () => {
  const project = await createTempProject("select-types");
  try {
    await writeFile(join(project.root, "package.json"), '{"private":true,"type":"module"}\n');
    await mkdir(join(project.root, "app", "components"), { recursive: true });
    await linkRepositoryPackages(project.root);
    const component = (template: string, script = ""): string => `<script lang="ts">
import { signal } from "@meekojs/meeko";
interface User { id: number; name: string }
const users = signal<User[]>([]);
const user = signal<User | null>(null);
const colors = ["Rojo", "Verde"];
const color = signal<string | null>(null);
const tags = signal<string[]>([]);
${script}
</script>
<template>${template}</template>`;
    const cases: Array<{ name: string; source: string; codes: string[]; message?: RegExp }> = [
      { name: "Valid", codes: [], source: component(`<MeekoSelect model="user" bind:options="users.value" by="id"><snippet name="option" params="u, state">{u.name}{state.selected ? "!" : ""}</snippet><snippet name="value" params="u">{u.name}</snippet></MeekoSelect><MeekoSelect model="tags" multiple bind:options="colors" bind:max="2" /><MeekoSelect model="color" bind:options="colors" /><MeekoPopover role="menu" placement="top-end" bind:offset="4" on:toggle="(event) => event.open"><snippet name="trigger">Más</snippet><p>x</p></MeekoPopover>`) },
      { name: "WrongModel", codes: ["TS2322"], source: component(`<MeekoSelect model="color" bind:options="users.value" />`) },
      { name: "MultipleNeedsArray", codes: ["TS2322"], source: component(`<MeekoSelect model="color" multiple bind:options="colors" />`) },
      { name: "SingleNeedsValue", codes: ["TS2322"], source: component(`<MeekoSelect model="tags" bind:options="colors" />`) },
      { name: "UnknownKey", codes: ["TS2322"], source: component(`<MeekoSelect model="user" bind:options="users.value" by="email" />`) },
      { name: "SnippetParam", codes: ["TS2339"], source: component(`<MeekoSelect model="user" bind:options="users.value"><snippet name="option" params="u">{u.email}</snippet></MeekoSelect>`), message: /'email' does not exist on type 'User'/ },
      { name: "Placement", codes: ["TS2322"], source: component(`<MeekoPopover placement="middle"><p>x</p></MeekoPopover>`) },
      {
        name: "Form", codes: [],
        source: component(`<MeekoSelect bind:field="form.field('color')" bind:options="colors" /><MeekoSelect model="form.fields.color" bind:options="colors" />`,
          `import { useForm } from "@meekojs/meeko/framework";\nconst form = useForm({ initial: { color: "" }, submit: () => {} });`),
      },
      {
        name: "Anchor", codes: [],
        source: component(`<MeekoPopover role="dialog"><snippet name="anchor" params="trigger"><a href="#x" bind:id="trigger.id" bind:aria-expanded="trigger['aria-expanded']" bind:aria-controls="trigger['aria-controls']">Abrir</a></snippet><p>x</p></MeekoPopover>`),
      },
    ];
    for (const item of cases) {
      const diagnostics = await checkSource(item.source, join(project.root, "app", "components", `${item.name}.meeko`));
      const messages = JSON.stringify(diagnostics);
      const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
      if (item.codes.length === 0) assert.deepEqual([...codes], [], `${item.name}: ${messages}`);
      for (const code of item.codes) assert.ok(codes.has(code), `${item.name}: ${messages}`);
      if (item.message) assert.match(messages, item.message, item.name);
    }
  } finally {
    await project.remove();
  }
});

test("the editor completes <MeekoPopover> and <MeekoSelect>, their props, and explains them on hover", { timeout: 60_000 }, async () => {
  const text = `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nconst color = signal<string | null>(null);\nconst colors = ["Rojo"];\n</script>\n<template><MeekoSelect model="color" bind:options="colors" s /><MeekoPopover r><snippet name="trigger">Más</snippet></MeekoPopover></template>`;
  const workspace = await languageProject("lsp-popover-select-", { "app/pages/index.meeko": text });
  try {
    const opened = await workspace.open("app/pages/index.meeko");
    const typing = TextDocument.create(opened.document.uri, "meeko", 2, `<script lang="ts"></script>\n<template><Meek</template>`);
    const typed = typing.positionAt(typing.getText().indexOf("<Meek") + 5);
    const names = componentNameCompletion(workspace.project, typing, opened.component.filename, typed)!.map((item) => item.label);
    assert.ok(names.includes("MeekoPopover") && names.includes("MeekoSelect"), JSON.stringify(names));
    const selectProps = directiveNameCompletion(opened.document, opened.at('colors" s', 9))!.map((item) => item.label);
    assert.ok(selectProps.includes("searchable") && selectProps.includes("groupBy") && selectProps.includes("bind:filter") && selectProps.includes("model:"), JSON.stringify(selectProps));
    const popoverItems = directiveNameCompletion(opened.document, opened.at("MeekoPopover r", 14))!;
    assert.equal((popoverItems.find((item) => item.label === "role")?.textEdit as { newText?: string } | undefined)?.newText, 'role="${1|menu,dialog,tooltip|}"');
    const docs = (hover(opened, opened.at("MeekoSelect", 3))?.contents as MarkupContent | undefined)?.value ?? "";
    assert.match(docs, /Etiqueta de Meeko · componente/);
    assert.match(docs, /aria-activedescendant/);
    assert.match(docs, /\[Guía de `<MeekoSelect>`\]/);
    const popoverDocs = (hover(opened, opened.at("MeekoPopover", 3))?.contents as MarkupContent | undefined)?.value ?? "";
    assert.match(popoverDocs, /anchor positioning/);
    assert.match(popoverDocs, /anchor\?\(trigger: PopoverTrigger\)/, "the snippets with their parameters");
    // The names of their snippets, from the compiled components.
    const withSnippet = text.replace(" s />", "><snippet name=\"o\"></snippet></MeekoSelect>");
    const snippetDoc = await workspace.open("app/pages/index.meeko", withSnippet);
    const snippetNames = (completion(snippetDoc, snippetDoc.at('name="o"', 6)) ?? []).map((item: CompletionItem) => item.label);
    assert.deepEqual(snippetNames.sort(), ["empty", "group", "loading", "option", "value"]);
    // The tags type-check in the editor like any component: only the half-written attributes fail.
    const valid = text.replace(" s />", " />").replace("MeekoPopover r>", "MeekoPopover>");
    const clean = TextDocument.create(opened.document.uri, "meeko", 3, valid);
    workspace.project.setDocument(opened.component.filename, valid);
    const diagnostics = await componentDiagnostics(workspace.project, clean, opened.component.filename, () => undefined);
    // Only the template: the test project lacks Node types for the framework sources it imports.
    const template = valid.indexOf("<template>");
    assert.deepEqual(diagnostics.filter((item) => clean.offsetAt(item.range.start) > template).map((item) => item.message), []);
    // A wrong prop is reported on the tag, with the types of the compiled component.
    const wrong = valid.replace('bind:options="colors"', 'bind:options="colors" bind:max="\'3\'"');
    workspace.project.setDocument(opened.component.filename, wrong);
    const reported = await componentDiagnostics(workspace.project, TextDocument.create(opened.document.uri, "meeko", 4, wrong), opened.component.filename, () => undefined);
    assert.ok(reported.some((item) => item.code === "TS2322"), JSON.stringify(reported.map((item) => item.message)));
  } finally {
    await workspace.dispose();
  }
});
