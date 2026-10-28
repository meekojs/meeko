/**
 * Runtime of `<MeekoAwait>`: the state of the resources it waits for, the reserved height of its
 * zone and the focus while its content changes.
 *
 * The reserve remembers, per route, request and instance, the height that the zone had with its
 * data, in `sessionStorage` and in memory. While the zone waits again for the same data, a rule of
 * a constructable stylesheet gives it that `min-block-size`: no `style="…"` attribute, so a strict
 * CSP allows it. On a full page load the inline script of `<head>` adopts those rules before the
 * first paint; in the browser, the component keeps them up to date and adopts them before it
 * inserts a zone.
 */
import { useId } from "../ids.js";
import { onMounted, setupPhase } from "../lifecycle.js";
import { computed, effect, isDryRender, untrack } from "../reactivity.js";
import type { ReadonlySignal } from "../reactivity.js";
import { useHead } from "./head.js";
import type { HeadInput } from "./head.js";
import { useRoute } from "./navigation.js";
import { resourceInternals } from "./resources.js";
import type { ResourceInternals } from "./resources.js";
import { currentBrowser } from "./storage.js";

/**
 * Lo que `<MeekoAwait for="…">` espera: el resultado de `useApi` o `useRpcQuery` (sin `await`), o
 * cualquier objeto con la misma forma. `DataResource` y `LoadedResource` lo cumplen.
 *
 * @since 1.5.0
 * @example
 * ```ts
 * import { signal } from "@meekojs/meeko";
 * import type { AwaitResource } from "@meekojs/meeko/framework";
 *
 * // Un recurso propio, por ejemplo de una caché externa.
 * const data = signal<string[] | null>(null);
 * const custom: AwaitResource = { data, error: signal(null), pending: signal(true), refresh: async () => {} };
 * ```
 */
export interface AwaitResource {
  /** Datos cargados, o `null` mientras no hay ninguno. */
  readonly data: ReadonlySignal<unknown>;
  /** Fallo de la última carga, o `null`. */
  readonly error: ReadonlySignal<Error | null>;
  /** `true` mientras hay una carga en curso. */
  readonly pending: ReadonlySignal<boolean>;
  /** Vuelve a pedir los datos; lo llama el `retry` del snippet `error`. */
  refresh(): Promise<void>;
}

/**
 * Textos de `<MeekoAwait>` cuando no recibe el snippet `error`, para traducirlos con
 * `bind:messages`.
 *
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoAwait for="items" bind:messages="{ error: 'Could not load the items.', retry: 'Retry' }">
 *   <ItemsList bind:items="items.data.value" />
 * </MeekoAwait>
 * ```
 */
export interface AwaitMessages {
  /** Aviso del fallo; por defecto, «No se pudieron cargar los datos.». */
  readonly error?: string;
  /** Texto del botón que vuelve a pedir los datos; por defecto, «Reintentar». */
  readonly retry?: string;
}

/**
 * Snippets de `<MeekoAwait>`. El contenido de la etiqueta es `default` y se pinta cuando todos los
 * recursos tienen datos; recibe `refreshing`, `true` durante una recarga. `pending` se pinta en la
 * primera carga y `error` cuando falla, con el error y `retry`, que vuelve a pedir los datos.
 *
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoAwait for="items" reserve>
 *   <snippet name="pending"><ItemsSkeleton /></snippet>
 *   <snippet name="error" params="error, retry"><p role="alert">{error.message} <button on:click="retry">Reintentar</button></p></snippet>
 *   <snippet name="default" params="refreshing"><ItemsList bind:items="items.data.value" bind:dimmed="refreshing" /></snippet>
 * </MeekoAwait>
 * ```
 */
export type MeekoAwaitSnippets = {
  /** El contenido con datos; `refreshing` es `true` durante una recarga, que lo conserva. */
  default: [refreshing: boolean];
  /** La primera carga: un esqueleto, idealmente con la altura del contenido. */
  pending?: [];
  /** Un fallo sin datos: el error y `retry`, que vuelve a pedir los recursos que fallaron. */
  error?: [error: Error, retry: () => void];
};

/** What `<MeekoAwait>` receives besides its snippets; `MeekoAwaitProps` of the framework documents it. */
export interface AwaitProps {
  for: AwaitResource | readonly AwaitResource[];
  reserve?: boolean | string;
  messages?: AwaitMessages;
  class?: string;
  id?: string;
}

/** The zone of `<MeekoAwait>`: `pending` (first load), `error` (a failed load without data) or `ready`. */
export type AwaitState = "pending" | "error" | "ready";

/** What the resources of a zone say, read in one pass. */
export interface AwaitStatus {
  readonly state: AwaitState;
  /** A resource with data is loading again. */
  readonly refreshing: boolean;
  /** The first failure of a resource without data. */
  readonly error: Error | null;
}

function internalsOf(resource: AwaitResource): ResourceInternals | undefined {
  return (resource as { [resourceInternals]?: ResourceInternals })[resourceInternals];
}

/** Whether the resource holds loaded data; `null` is a real output of `useApi` and `useRpcQuery`. */
function hasData(resource: AwaitResource): boolean {
  const internals = internalsOf(resource);
  return internals ? internals.loaded.value : resource.data.value !== null && resource.data.value !== undefined;
}

/**
 * The state of a zone. A failed resource without data wins, so `retry` is offered at once; a
 * resource without data that is loading (or has not started) keeps the zone `pending`.
 */
export function awaitStatus(resources: readonly AwaitResource[]): AwaitStatus {
  let waiting = false;
  let refreshing = false;
  let error: Error | null = null;
  for (const resource of resources) {
    const pending = resource.pending.value;
    if (hasData(resource)) {
      if (pending) refreshing = true;
      continue;
    }
    const failure = resource.error.value;
    if (!pending && failure) error ??= failure;
    else waiting = true;
  }
  return { state: error ? "error" : waiting ? "pending" : "ready", refreshing, error };
}

/** The resources of `for`: one or a list, checked. */
export function awaitResources(value: unknown): readonly AwaitResource[] {
  const list = Array.isArray(value) ? value as unknown[] : [value];
  for (const entry of list) {
    const resource = entry as Partial<AwaitResource> | null | undefined;
    if (!resource || typeof resource !== "object" || !resource.data || !resource.pending || !resource.error || typeof resource.refresh !== "function") {
      throw new TypeError("<MeekoAwait>: for must be a resource of useApi or useRpcQuery (without await), or a list of them, as for=\"items\" or for=\"[items, stats]\"");
    }
  }
  return list as AwaitResource[];
}

/** The request keys of a zone, as in the page payload; a resource of its own has none. */
export function awaitRequestKeys(resources: readonly AwaitResource[]): string[] {
  return resources.map((resource) => internalsOf(resource)?.key.value ?? "");
}

/** Whether `reserve` is on: `reserve`, `reserve=""`, `bind:reserve="true"` or a length. */
export function reserveEnabled(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}

const lengthPattern = /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|vh|svh|lvh|dvh|vb|svb|lvb|dvb|ch|ex|lh|rlh|cm|mm|in|pt|pc|q|%)$/i;

/**
 * The explicit minimum of `reserve="320px"`: a CSS length, or `undefined` for `reserve` alone.
 * Anything else throws, because it ends up in a CSS rule.
 */
export function reserveMinimum(value: unknown): string | undefined {
  if (!reserveEnabled(value) || value === true || value === "") return undefined;
  if (typeof value !== "string" || !lengthPattern.test(value.trim())) {
    throw new TypeError(`<MeekoAwait>: reserve must be empty or a CSS length such as reserve="320px", not ${JSON.stringify(value)}`);
  }
  const length = value.trim();
  return /^0*\.?0*[a-z%]+$/i.test(length) ? undefined : length;
}

/**
 * Key of a zone in the memory: route, request keys and the instance (its `useId`), hashed (FNV-1a)
 * to a short token that the CSS selector and the storage can hold.
 */
export function reserveZoneKey(path: string, requestKeys: readonly string[], instance: string): string {
  const text = `${path}\n${requestKeys.join("\n")}\n${instance}`;
  let hash = 0x811c9dc5;
  for (let position = 0; position < text.length; position++) {
    hash ^= text.charCodeAt(position);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Key of the memory in `sessionStorage`. */
export const RESERVE_STORAGE_KEY = "meeko:await";
/** Most zones kept; the oldest go first. */
const maxZones = 100;
const zonePattern = /^[a-z0-9]{1,13}$/;
const validHeight = (value: unknown): value is number => typeof value === "number" && value > 0 && value <= 1e5;

/** The CSS of an explicit minimum: the custom property that the memory compares, and the minimum itself. */
export function minimumRule(length: string): string {
  return `[data-meeko-reserve-min="${length}"]{--meeko-await-min:${length}}[data-meeko-await=pending][data-meeko-reserve-min="${length}"]{min-block-size:${length}}`;
}

/** The rule of a remembered zone: never below the explicit minimum of the same zone. */
function zoneRule(zone: string, height: number): string {
  return `[data-meeko-await=pending][data-meeko-reserve][data-meeko-reserve="${zone}"]{min-block-size:max(${height}px,var(--meeko-await-min,0px))}`;
}

/** Every rule of the reserve: the explicit minimums, then the remembered zones (which win by specificity). */
export function reserveRules(memory: Readonly<Record<string, number>>, minimums: readonly string[] = []): string {
  let rules = "";
  for (const length of minimums) if (lengthPattern.test(length)) rules += minimumRule(length);
  for (const [zone, height] of Object.entries(memory)) if (zonePattern.test(zone) && validHeight(height)) rules += zoneRule(zone, height);
  return rules;
}

/**
 * The inline script that `<MeekoAwait reserve>` adds to `<head>`: before the first paint of a full
 * load, it reads the memory of `sessionStorage` and adopts its rules in a constructable
 * stylesheet. It only touches the CSSOM (no attribute, no node), so hydration finds the HTML of
 * the server; its text never changes, so every page has the same CSP hash. Keep it in step with
 * {@link reserveRules} and {@link registryOf}.
 */
export const reserveScript = "(function(){try{var w=window,k=Symbol.for(\"meeko.await\"),d=document,m={},r=\"\",v,z,h,s;if(w[k])return;"
  + "v=JSON.parse(sessionStorage.getItem(\"meeko:await\")||\"{}\");"
  + "for(z in v){h=v[z];if(/^[a-z0-9]{1,13}$/.test(z)&&typeof h==\"number\"&&h>0&&h<=1e5){m[z]=h;"
  + "r+='[data-meeko-await=pending][data-meeko-reserve][data-meeko-reserve=\"'+z+'\"]{min-block-size:max('+h+'px,var(--meeko-await-min,0px))}'}}"
  + "w[k]={memory:m};if(r&&d.adoptedStyleSheets&&w.CSSStyleSheet){s=new CSSStyleSheet();s.replaceSync(r);d.adoptedStyleSheets=[].concat(Array.from(d.adoptedStyleSheets),s);w[k].sheet=s}}catch(e){}})();";

/** Key of {@link reserveScript} and its `<style>` siblings in `<head>`. */
const HEAD_KEY = "meeko:await";

/** What a window keeps of the reserve: the head script creates it, the component completes it. */
interface ReserveRegistry {
  memory: Record<string, number>;
  sheet?: CSSStyleSheet;
  minimums?: string[];
}

const registryKey = Symbol.for("meeko.await");

function readMemory(browser: Window): Record<string, number> {
  const memory: Record<string, number> = {};
  try {
    const stored = JSON.parse(browser.sessionStorage.getItem(RESERVE_STORAGE_KEY) ?? "{}") as unknown;
    if (stored && typeof stored === "object") {
      for (const [zone, height] of Object.entries(stored)) if (zonePattern.test(zone) && validHeight(height)) memory[zone] = height;
    }
  } catch { /* Storage blocked (private mode, a sandbox) or corrupt: the memory starts empty. */ }
  return memory;
}

/** The reserve of a window, from the head script or read now. */
function registryOf(browser: Window): ReserveRegistry {
  const host = browser as unknown as { [registryKey]?: ReserveRegistry };
  let registry = host[registryKey];
  if (!registry || typeof registry !== "object" || !registry.memory) {
    registry = { memory: readMemory(browser) };
    host[registryKey] = registry;
  }
  return registry;
}

/** Writes the rules to the window's sheet, adopting it first; a browser without constructable sheets keeps the natural height. */
function syncSheet(browser: Window, registry: ReserveRegistry): void {
  const document = browser.document as Document | undefined;
  const Sheet = (browser as unknown as { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet;
  if (!document || !Sheet || !("adoptedStyleSheets" in document)) return;
  try {
    registry.sheet ??= new Sheet();
    const adopted = Array.from(document.adoptedStyleSheets);
    if (!adopted.includes(registry.sheet)) document.adoptedStyleSheets = [...adopted, registry.sheet];
    registry.sheet.replaceSync(reserveRules(registry.memory, registry.minimums));
  } catch { /* Without constructable stylesheets the zone keeps its natural height. */ }
}

/**
 * Makes the rules of the reserve active in a window before a zone is inserted: after a full load
 * the head script already did it; after a navigation from a page without `<MeekoAwait reserve>`,
 * this does. `minimum` adds the rule of `reserve="320px"`.
 */
export function prepareReserve(browser: Window, minimum: string | undefined): void {
  const registry = registryOf(browser);
  const minimums = registry.minimums ??= [];
  const added = minimum !== undefined && !minimums.includes(minimum);
  if (added) minimums.push(minimum);
  if (added || !registry.sheet || !Array.from(browser.document.adoptedStyleSheets ?? []).includes(registry.sheet)) syncSheet(browser, registry);
}

/** Remembers the height of a zone with its data; `0` forgets it. */
export function rememberHeight(browser: Window, zone: string, height: number): void {
  if (!zonePattern.test(zone) || !Number.isFinite(height)) return;
  const registry = registryOf(browser);
  const rounded = Math.round(height * 100) / 100;
  const value = rounded > 0 && rounded <= 1e5 ? rounded : undefined;
  if (registry.memory[zone] === value) return;
  delete registry.memory[zone];
  if (value !== undefined) registry.memory[zone] = value;
  const zones = Object.keys(registry.memory);
  for (let extra = zones.length - maxZones; extra > 0; extra--) delete registry.memory[zones.shift()!];
  try { browser.sessionStorage.setItem(RESERVE_STORAGE_KEY, JSON.stringify(registry.memory)); }
  catch { /* Storage blocked or full: the memory stays for this page. */ }
  syncSheet(browser, registry);
}

/** The remembered height of a zone in a window, if any. */
export function rememberedHeight(browser: Window, zone: string): number | undefined {
  return registryOf(browser).memory[zone];
}

/** The defaults of {@link AwaitMessages}. */
const defaultMessages: Required<AwaitMessages> = { error: "No se pudieron cargar los datos.", retry: "Reintentar" };

/** What the template of `<MeekoAwait>` reads. */
export interface AwaitZone {
  readonly state: ReadonlySignal<AwaitState>;
  readonly refreshing: ReadonlySignal<boolean>;
  /** `"true"` while the zone loads or reloads, for `aria-busy`. */
  readonly busy: ReadonlySignal<"true" | undefined>;
  /** The failure that the `error` snippet receives; only read in the `error` state. */
  readonly error: ReadonlySignal<Error>;
  /** `data-meeko-reserve`: the key of the zone in the memory, with `reserve`. */
  readonly reserve: ReadonlySignal<string | undefined>;
  /** `data-meeko-reserve-min`: the explicit minimum of `reserve="320px"`. */
  readonly minimum: ReadonlySignal<string | undefined>;
  readonly messages: ReadonlySignal<Required<AwaitMessages>>;
  /** Asks again for the data of every failed resource without data. */
  retry(): void;
}

/** The current route, or none outside an application of Meeko (a plain `renderToString`). */
function routeOrNone(): ReturnType<typeof useRoute> | undefined {
  try { return useRoute(); }
  catch { return undefined; }
}

/** The head entries of a zone with `reserve`: the script of the memory and the style of its minimum. */
function reserveHead(minimum: string | undefined): HeadInput {
  return {
    script: [{ key: HEAD_KEY, children: reserveScript }],
    ...(minimum ? { style: [{ key: `${HEAD_KEY}:${minimum}`, children: minimumRule(minimum) }] } : {}),
  };
}

/**
 * The setup of `<MeekoAwait>`: its state, the reserve of its zone and the focus. `box` is the
 * container element, once mounted.
 */
export function useAwaitZone(props: AwaitProps, box: ReadonlySignal<Element | null | undefined>): AwaitZone {
  const phase = setupPhase();
  const dry = isDryRender();
  const resources = computed(() => awaitResources(props.for));
  const status = computed(() => awaitStatus(resources.value));
  const state = computed(() => status.value.state);
  const refreshing = computed(() => status.value.state === "ready" && status.value.refreshing);
  const busy = computed(() => state.value === "pending" || refreshing.value ? "true" as const : undefined);
  const error = computed(() => status.value.error ?? new Error(defaultMessages.error));
  const messages = computed(() => ({ error: props.messages?.error ?? defaultMessages.error, retry: props.messages?.retry ?? defaultMessages.retry }));
  const retry = (): void => {
    for (const resource of untrack(() => resources.value)) {
      if (untrack(() => !hasData(resource) && resource.error.value && !resource.pending.value)) void resource.refresh();
    }
  };

  // The reserve: a key per route, requests and instance, and the head script that applies it.
  const minimum = computed(() => reserveMinimum(props.reserve));
  const route = routeOrNone();
  // The instance is the position of the zone in the tree (`useId`): the same in SSR, hydration and
  // a later visit, and its own for two zones of the same requests on one page.
  const instance = useId();
  const reserve = computed(() => reserveEnabled(props.reserve)
    ? reserveZoneKey(route?.path.value ?? "", awaitRequestKeys(resources.value), instance)
    : undefined);
  // `bind:reserve` may change: the head script, the rules and the measurement follow it.
  const reserving = computed(() => reserveEnabled(props.reserve));
  if (!dry) useHead(() => reserving.value ? reserveHead(minimum.value) : {});
  const browser = currentBrowser();
  // Before the zone is inserted (a navigation, a late mount): the rules exist when it is painted.
  if (browser && !dry) effect(() => { if (reserving.value) prepareReserve(browser, minimum.value); });

  if (phase === "mount" && !dry) {
    // Measure only with data, after layout (ResizeObserver), never blocking the render.
    onMounted(() => {
      const element = untrack(() => box.value);
      const view = element?.ownerDocument.defaultView as (Window & { ResizeObserver?: typeof ResizeObserver }) | null | undefined;
      const Observer = view?.ResizeObserver;
      if (!element || !view || !Observer) return;
      let observer: ResizeObserver | undefined;
      // A new state or zone measures again, even when its size did not change; no zone, no observer.
      const stop = effect(() => {
        void state.value;
        if (!reserve.value) {
          observer?.disconnect();
          observer = undefined;
          return;
        }
        if (observer) observer.unobserve(element);
        else {
          observer = new Observer((entries) => {
            const zone = untrack(() => reserve.value);
            const entry = entries.at(-1);
            if (!zone || !entry || untrack(() => state.value) !== "ready") return;
            const borderBox = view.getComputedStyle(element).boxSizing === "border-box";
            const size = (borderBox ? entry.borderBoxSize : entry.contentBoxSize)?.[0]?.blockSize
              ?? (borderBox ? element.getBoundingClientRect().height : entry.contentRect.height);
            rememberHeight(view, zone, size);
          });
        }
        observer.observe(element);
      });
      return () => { stop(); observer?.disconnect(); };
    });
    // The focus never falls to <body>: when the node that had it leaves (a retry button, a
    // focusable skeleton), the zone takes it, without scrolling.
    let previous = untrack(() => state.value);
    effect(() => {
      const next = state.value;
      if (next === previous) return;
      previous = next;
      const element = untrack(() => box.value);
      const document = element?.ownerDocument;
      const active = document?.activeElement;
      if (!element || !document || !active || active === element || !element.contains(active)) return;
      queueMicrotask(() => {
        if (!element.isConnected) return;
        const now = document.activeElement;
        if (now && now !== document.body && now.isConnected) return;
        if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
        (element as HTMLElement).focus({ preventScroll: true });
      });
    });
  }
  return { state, refreshing, busy, error, reserve, minimum, messages, retry };
}
