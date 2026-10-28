import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import type { Page } from "playwright-core";
import { buildProject } from "../src/framework/project.ts";
import { createTempProject, linkRepositoryPackages } from "./helpers/temp-project.ts";

const countrySchema = `type Issue = { message: string; path: Array<{ key: string }> };
type Values = { country: string };
export const countryInput = {
  "~standard": {
    version: 1 as const,
    vendor: "e2e",
    types: undefined as { input: Values; output: Values } | undefined,
    validate(value: unknown): { value: Values } | { issues: Issue[] } {
      const input = value as Values;
      return input.country ? { value: input } : { issues: [{ message: "Elige un país.", path: [{ key: "country" }] }] };
    },
  },
};
`;

const page = `<script lang="ts">
import { countryInput } from "../../shared/schemas/country.js";
const menuOpen = signal(false);
const picked = signal("");
const colors = ["Rojo", "Verde", "Azul", "Ámbar"];
const color = signal<string | null>(null);
const tags = signal<string[]>([]);
const low = signal<string | null>(null);
const sent = signal("");
const saved = signal("");
const countries = ["Chile", "España", "México", "Perú"];
const form = useForm({ schema: countryInput, initial: { country: "" }, submit: (values) => { saved.value = values.country; }, focusInvalid: true });
function send(event: SubmitEvent): void {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  sent.value = [...data.entries()].map(([name, value]) => \`\${name}=\${String(value)}\`).join("&");
}
</script>
<template>
  <main>
    <MeekoPopover role="menu" model="menuOpen" placement="bottom-start" bind:offset="4" triggerClass="menu-button">
      <snippet name="trigger">Opciones</snippet>
      <button role="menuitem" on:click="() => picked.value = 'renombrar'">Renombrar</button>
      <button role="menuitem" on:click="() => picked.value = 'duplicar'">Duplicar</button>
      <button role="menuitem" on:click="() => picked.value = 'eliminar'">Eliminar</button>
    </MeekoPopover>
    <p id="picked">{picked.value}</p>
    <MeekoPopover mode="hint" bind:delay="100" triggerClass="help"><snippet name="trigger">?</snippet>Ayuda contextual</MeekoPopover>
    <input id="after-help">
    <form id="native" on:submit="send">
      <label for="color">Color</label>
      <MeekoSelect id="color" model="color" bind:options="colors" name="color" placeholder="Elige un color" required />
      <label for="tags">Etiquetas</label>
      <MeekoSelect id="tags" model="tags" multiple searchable bind:options="colors" bind:max="2" name="tags" placeholder="Busca" />
      <button id="send">Enviar</button>
    </form>
    <p id="sent">{sent.value}</p>
    <form id="profile" on:submit="form.submit" novalidate>
      <label bind:for="form.field('country').id">País</label>
      <MeekoSelect bind:field="form.field('country')" bind:options="countries" placeholder="Elige un país" />
      <p class="error" if:when="form.errors.value.country" bind:id="form.field('country').errorId">{form.errors.value.country}</p>
      <button id="save">Guardar</button>
    </form>
    <p id="saved">{saved.value}</p>
    <div class="bottom"><MeekoSelect id="low" model="low" bind:options="colors" placeholder="Abajo" /></div>
  </main>
</template>
<style>
main { padding: 16px; }
[role="option"][data-active] { outline: 2px solid; }
[data-meeko-popover] { background: canvas; border: 1px solid; padding: 0; }
.bottom { position: fixed; left: 24px; bottom: 8px; }
</style>
`;

/** CSP violations and errors of the page, from the start of each document. */
const probe = (): void => {
  const violations: string[] = [];
  Object.assign(window, { __cspViolations: violations });
  document.addEventListener("securitypolicyviolation", (event) => violations.push(`${event.violatedDirective} ${event.blockedURI}`));
};

/** The box of an element, or of the popover that holds it. */
const rect = (page: Page, selector: string, popover = false) => page.locator(selector).first().evaluate((element, outer) => {
  const box = (outer ? element.closest("[data-meeko-popover]")! : element).getBoundingClientRect();
  return { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width) };
}, popover);

test("<MeekoPopover> and <MeekoSelect> in Chrome: menu, tooltip, select with keyboard and mouse, search, multiple, forms, flip and a strict CSP", { timeout: 300_000 }, async () => {
  const project = await createTempProject("popover-select-e2e");
  const root = project.root;
  type ServerModule = typeof import("../src/framework-server.ts");
  type NodeModule = typeof import("../src/node.ts");
  let server: import("node:http").Server | undefined;
  let app: Awaited<ReturnType<ServerModule["createServerApp"]>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const files: Record<string, string> = {
      "package.json": '{"name":"popover-select-app","private":true,"type":"module"}\n',
      "shared/schemas/country.ts": countrySchema,
      "app/pages/index.meeko": page,
    };
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), contents);
    }
    await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
    const built = await buildProject(root);
    const { createServerApp } = await import(pathToFileURL(resolve("dist/framework-server.js")).href) as ServerModule;
    const { createNodeAssetReader, toNodeListener } = await import(pathToFileURL(resolve("dist/node.js")).href) as NodeModule;
    const output = await import(pathToFileURL(join(built.output, "index.mjs")).href) as Pick<Parameters<ServerModule["createServerApp"]>[0], "load" | "manifest">;
    const nonce = randomUUID().replaceAll("-", "");
    // No 'unsafe-inline' anywhere: the components style themselves through CSSOM.
    const policy = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; form-action 'self'; object-src 'none'; base-uri 'none'`;
    app = await createServerApp({
      manifest: output.manifest, load: output.load, production: false,
      assets: createNodeAssetReader({ root: join(built.output, "client"), assets: output.manifest.assets ?? {} }),
      document: { nonce: () => nonce },
    });
    const running = app;
    server = createHttpServer(toNodeListener(async (request) => {
      const response = await running.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("content-security-policy", policy);
      return new Response(response.body, { status: response.status, headers });
    }));
    await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
    });

    // The HTML of the server: the select shows its placeholder and the lists are hidden by popover.
    const html = (await (await fetch(`${origin}/`)).text()).replace(/<!--\/?meeko:[^>]*-->/g, "");
    assert.match(html, /<span data-meeko-select-placeholder="">Elige un color<\/span>/);
    assert.match(html, /popover="manual"/);
    assert.doesNotMatch(html, /\sstyle="/);

    const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
    await context.addInitScript(probe);
    const tab = await context.newPage();
    const errors: string[] = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    tab.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await tab.goto(`${origin}/`);
    await tab.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);
    const focused = () => tab.evaluate(() => document.activeElement?.textContent?.trim() ?? document.activeElement?.id ?? "");
    const visible = (selector: string) => tab.locator(selector).first().evaluate((element) => element.matches(":popover-open"));

    // 1. Menu with the keyboard: Enter opens it on the first item, the arrows move, Enter chooses, the focus goes back.
    const menuButton = tab.locator(".menu-button");
    const menu = tab.locator("[role=menu]");
    await menuButton.focus();
    await tab.keyboard.press("Enter");
    await tab.waitForFunction(() => document.querySelector("[role=menu]")!.matches(":popover-open"));
    // aria-expanded follows the toggle event, which the browser fires in the next task.
    await tab.waitForFunction(() => document.querySelector(".menu-button")!.getAttribute("aria-expanded") === "true");
    await tab.waitForFunction(() => document.activeElement?.textContent === "Renombrar");
    await tab.keyboard.press("ArrowDown");
    assert.equal(await focused(), "Duplicar");
    await tab.keyboard.press("e");
    assert.equal(await focused(), "Eliminar", "typeahead");
    // Anchored below its trigger, with its offset, through CSS anchor positioning.
    const button = await rect(tab, ".menu-button");
    const list = await rect(tab, "[role=menu]");
    assert.ok(Math.abs(list.top - button.bottom - 4) <= 1 && Math.abs(list.left - button.left) <= 1, JSON.stringify({ button, list }));
    await tab.keyboard.press("Enter");
    await tab.locator("#picked", { hasText: "eliminar" }).waitFor();
    assert.equal(await visible("[role=menu]"), false);
    assert.equal(await tab.evaluate(() => document.activeElement?.className), "menu-button");
    // Escape closes and gives the focus back; a click outside closes too.
    await tab.keyboard.press("ArrowDown");
    await tab.waitForFunction(() => document.activeElement?.textContent === "Renombrar");
    await tab.keyboard.press("Escape");
    await tab.waitForFunction(() => !document.querySelector("[role=menu]")!.matches(":popover-open"));
    assert.equal(await tab.evaluate(() => document.activeElement?.className), "menu-button");
    await menuButton.click();
    await menu.waitFor({ state: "visible" });
    await tab.mouse.click(850, 300);
    await menu.waitFor({ state: "hidden" });
    await tab.waitForFunction(() => document.querySelector(".menu-button")!.getAttribute("aria-expanded") === "false");

    // 2. Tooltip (mode="hint"): hover opens it after the delay without taking the focus, Escape closes it.
    const help = tab.locator(".help");
    const tooltip = tab.locator("[role=tooltip]");
    assert.equal(await help.getAttribute("aria-describedby"), await tooltip.getAttribute("id"));
    await tab.locator("#after-help").focus();
    await help.hover();
    await tooltip.waitFor({ state: "visible" });
    assert.equal(await tab.evaluate(() => document.activeElement?.id), "after-help", "the tooltip does not take the focus");
    await tab.keyboard.press("Escape");
    await tooltip.waitFor({ state: "hidden" });
    await help.focus();
    await tooltip.waitFor({ state: "visible" });
    await tab.locator("#after-help").focus();
    await tooltip.waitFor({ state: "hidden" });

    // 3. Required: the form does not submit and the select shows the error and takes the focus.
    const color = tab.locator("#color");
    await tab.locator("#send").click();
    assert.equal(await tab.locator("#sent").innerText(), "");
    assert.equal(await color.getAttribute("aria-invalid"), "true");
    assert.equal(await tab.evaluate(() => document.activeElement?.id), "color");

    // 4. Select with the keyboard: the focus stays on the trigger while aria-activedescendant moves.
    await tab.keyboard.press("ArrowDown");
    await tab.waitForFunction(() => document.getElementById("color")!.getAttribute("aria-expanded") === "true");
    const active = () => tab.evaluate(() => document.getElementById(document.getElementById("color")!.getAttribute("aria-activedescendant") ?? "")?.textContent ?? "");
    assert.equal(await active(), "Rojo");
    await tab.keyboard.press("ArrowDown");
    assert.equal(await active(), "Verde");
    await tab.keyboard.press("End");
    assert.equal(await active(), "Ámbar");
    // The list is as wide as its trigger at least, below it.
    const trigger = await rect(tab, "#color");
    const listbox = await rect(tab, `#${await color.getAttribute("aria-controls")}`, true);
    assert.ok(listbox.width >= trigger.width - 1 && listbox.top >= trigger.bottom - 1, JSON.stringify({ trigger, listbox }));
    await tab.keyboard.press("Enter");
    assert.equal(await color.innerText(), "Ámbar");
    assert.equal(await color.getAttribute("aria-expanded"), "false");
    assert.equal(await color.getAttribute("aria-invalid"), null, "a value clears the error");
    assert.equal(await tab.evaluate(() => document.activeElement?.id), "color");
    // And with the mouse.
    await color.click();
    await tab.locator("[role=option]", { hasText: "Verde" }).first().click();
    assert.equal(await color.innerText(), "Verde");
    assert.equal(await color.getAttribute("aria-expanded"), "false");

    // 5. Search and multiple with max: typing filters without accents, Enter adds, max blocks.
    const tags = tab.locator("#tags");
    const tagList = tab.locator(`#${await tags.getAttribute("aria-controls")}`);
    await tags.click();
    await tags.pressSequentially("amb");
    await tab.waitForFunction(() => [...document.querySelectorAll(`#${document.getElementById("tags")!.getAttribute("aria-controls")} [role=option]`)].map((option) => option.textContent).join() === "Ámbar");
    await tab.keyboard.press("Enter");
    assert.equal(await tags.inputValue(), "");
    await tagList.locator("[role=option]", { hasText: "Rojo" }).click();
    assert.equal(await tagList.locator("[role=option]", { hasText: "Azul" }).getAttribute("aria-disabled"), "true", "max=2 reached");
    await tagList.locator("[role=option]", { hasText: "Azul" }).click({ force: true });
    assert.equal(await tagList.locator("[aria-selected=true]").count(), 2);
    assert.equal(await tags.getAttribute("aria-expanded"), "true", "a multiple select stays open");
    await tab.keyboard.press("Escape");
    assert.equal(await tags.getAttribute("aria-expanded"), "false");

    // 6. The native form submits one hidden input per value.
    await tab.locator("#send").click();
    await tab.locator("#sent", { hasText: "color=" }).waitFor();
    assert.equal(await tab.locator("#sent").innerText(), "color=Verde&tags=Ámbar&tags=Rojo");

    // 7. useForm: form.field() gives the id, aria-invalid and aria-describedby, and focusInvalid finds the select.
    const country = tab.locator("#profile [data-meeko-select-trigger]");
    assert.equal(await tab.locator("#profile label").getAttribute("for"), await country.getAttribute("id"));
    await tab.locator("#save").click();
    await tab.locator("#profile .error").waitFor();
    assert.equal(await country.getAttribute("aria-invalid"), "true");
    assert.equal(await country.getAttribute("aria-describedby"), await tab.locator("#profile .error").getAttribute("id"));
    await tab.waitForFunction(() => document.activeElement?.matches("#profile [data-meeko-select-trigger]") === true);
    await tab.keyboard.press("ArrowDown");
    await tab.keyboard.press("ArrowDown");
    await tab.keyboard.press("Enter");
    assert.equal(await country.innerText(), "España");
    assert.equal(await tab.locator("#profile .error").count(), 0, "the field revalidates once it has an error");
    assert.equal(await country.getAttribute("aria-invalid"), null);
    await tab.locator("#save").click();
    await tab.locator("#saved", { hasText: "España" }).waitFor();

    // 8. No room below: the list opens above its trigger.
    const low = tab.locator("#low");
    await low.click();
    await tab.waitForFunction(() => document.getElementById("low")!.getAttribute("aria-expanded") === "true");
    const lowTrigger = await rect(tab, "#low");
    const lowList = await rect(tab, `#${await low.getAttribute("aria-controls")}`, true);
    assert.ok(lowList.bottom <= lowTrigger.top + 1, JSON.stringify({ lowTrigger, lowList }));
    await tab.keyboard.press("Escape");

    assert.deepEqual(await tab.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations), []);
    assert.deepEqual(errors, []);
    await context.close();

    // 9. A browser without CSS anchor positioning: the script places the list, also above when it does not fit.
    const fallback = await browser.newContext({ viewport: { width: 900, height: 700 } });
    await fallback.addInitScript(probe);
    await fallback.addInitScript(() => {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = ((property: string, value?: string) => /anchor|position-area/.test(property) ? false : value === undefined ? supports(property) : supports(property, value)) as typeof CSS.supports;
    });
    const plain = await fallback.newPage();
    const fallbackErrors: string[] = [];
    plain.on("pageerror", (error) => fallbackErrors.push(error.message));
    await plain.goto(`${origin}/`);
    await plain.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);
    await plain.locator(".menu-button").click();
    await plain.waitForFunction(() => document.querySelector("[role=menu]")!.matches(":popover-open"));
    assert.ok(await plain.locator("[role=menu]").evaluate((element) => element.hasAttribute("data-meeko-popover-fallback")));
    const fallbackButton = await rect(plain, ".menu-button");
    await plain.waitForFunction(() => document.querySelector("[role=menu]")!.getAttribute("data-side") === "bottom");
    const fallbackMenu = await rect(plain, "[role=menu]");
    assert.ok(Math.abs(fallbackMenu.top - fallbackButton.bottom - 4) <= 1 && Math.abs(fallbackMenu.left - fallbackButton.left) <= 1, JSON.stringify({ fallbackButton, fallbackMenu }));
    await plain.keyboard.press("Escape");
    await plain.locator("#low").click();
    await plain.waitForFunction(() => document.querySelector("#low")!.getAttribute("aria-expanded") === "true");
    const fallbackLowList = `#${await plain.locator("#low").getAttribute("aria-controls")}`;
    await plain.waitForFunction((selector) => document.querySelector(selector)!.closest("[data-meeko-popover]")!.getAttribute("data-side") === "top", fallbackLowList);
    const fallbackLow = await rect(plain, "#low");
    const fallbackLowBox = await rect(plain, fallbackLowList, true);
    assert.ok(fallbackLowBox.bottom <= fallbackLow.top + 1 && fallbackLowBox.width >= fallbackLow.width - 1, JSON.stringify({ fallbackLow, fallbackLowBox }));
    assert.deepEqual(await plain.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations), []);
    assert.deepEqual(fallbackErrors, []);
    await fallback.close();
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    await app?.close();
    await project.remove();
  }
});
