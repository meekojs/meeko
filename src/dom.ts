import { batch, createRoot, currentEffectOwner, effect, finishWithCleanup, isWritableSignal, signal, switchOwner, untrack } from "./reactivity.js";
import { observeCallback } from "./error-observer.js";
import { componentErrorReporter } from "./component-errors.js";
import type { EffectSource, Signal } from "./reactivity.js";
import { attributeValue, rawHtml, serializeJson } from "./server.js";
import { refTarget } from "./element-refs.js";
import type { ElementRefs } from "./element-refs.js";
import { isLateSuspension, isPassSuspension, lateRender, loadDeferred } from "./suspense.js";
import { afterMountBatch, mountBatch } from "./lifecycle.js";
import { contentNamespace, inertElement } from "./html-content.js";
import { sameChannels } from "./channels.js";
import type { NativeModelKind, NativeModelValues } from "./models.js";
import { snippetOf } from "./snippets.js";
import type { Snippet, SnippetData } from "./snippets.js";

/**
 * Fragmento de DOM que pertenece a una instancia o a una región dinámica: los hijos de `root` o,
 * con marcadores, los nodos entre los comentarios `start` y `end`.
 *
 * @example
 * ```ts
 * import type { DomScope } from "@meekojs/meeko";
 * import { hydrateScope } from "./Card.meeko";
 *
 * const scope: DomScope = { root: document.querySelector("#card")! };
 * const release = hydrateScope(scope, { title: "Hola" });
 * ```
 */
export interface DomScope {
  /** Elemento que contiene la instancia. */
  root: Element;
  /** Comentario inicial de la región, si no ocupa todo `root`. */
  start?: Comment;
  /** Comentario final de la región. */
  end?: Comment;
}

/**
 * Contrato de un módulo de componente compilado para componerlo sin elemento envolvente. A
 * diferencia de {@link Component}, `renderWithState` es opcional: sirve para usos de bajo nivel que
 * renderizan sin transferir estado.
 *
 * @typeParam Props Props del componente.
 * @example
 * ```ts
 * import type { ComponentModule } from "@meekojs/meeko";
 *
 * function renderAll<P extends object>(module: ComponentModule<P>, list: readonly P[]): string {
 *   return list.map((props) => module.renderToString(props)).join("");
 * }
 * ```
 */
export interface ComponentModule<Props extends object> {
  /** Renderiza el HTML, opcionalmente desde un estado capturado. */
  readonly renderToString: (props: Props, state?: Record<string, unknown>) => string;
  /** Renderiza el HTML y captura el estado de sus señales. */
  readonly renderWithState?: (props: Props) => { html: string; state: Record<string, unknown> };
  /** Hidrata el HTML de `scope`; devuelve la función de liberación. */
  readonly hydrateScope: (scope: DomScope, props: Props, state?: Record<string, unknown>) => ComponentRelease;
}

/**
 * Componente compilado que puede transferir su estado durante SSR. Es el tipo que exige
 * `<component is>`, y el del `outlet` de `app/app.meeko` y los layouts.
 *
 * @typeParam Props Props del componente.
 * @example
 * ```html
 * <!-- Card.meeko -->
 * <script lang="ts">
 * import type { Component } from "@meekojs/meeko";
 * const props = defineProps<{ content: Component<{ label: string }>; label: string }>();
 * </script>
 * <template><section><component is="props.content" bind:label="props.label"></component></section></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#componentes-meeko
 */
export type Component<Props extends object> = ComponentModule<Props> & {
  readonly renderWithState: (props: Props) => { html: string; state: Record<string, unknown> };
};

/**
 * Función que libera una instancia hidratada: observadores, eventos y limpiezas. Puede exponer el
 * estado editable de la instancia y, desde 1.1, el valor de su `defineExpose`.
 *
 * @typeParam Exposed Tipo del valor expuesto.
 * @example
 * ```ts
 * import type { ComponentRelease } from "@meekojs/meeko";
 * import { hydrateScope } from "./SearchBox.meeko";
 *
 * const release: ComponentRelease = hydrateScope({ root: document.querySelector("#search")! }, {});
 * console.log(release.snapshot?.(), release.exposed);
 * release();
 * ```
 */
export interface ComponentRelease<Exposed = unknown> {
  (): void;
  /** Lee el estado editable actual de la instancia. */
  snapshot?: () => Record<string, unknown>;
  /** Valor del `defineExpose` de la instancia, o `null` si no lo tiene. */
  readonly exposed?: Exposed;
}

/** Releases every compiled binding and preserves the failure that triggered cleanup. */
export function releaseAll(cleanups: Array<() => void>, cause: { error: unknown }): never;
export function releaseAll(cleanups: Array<() => void>): void;
export function releaseAll(cleanups: Array<() => void>, cause?: { error: unknown }): void {
  const failures: unknown[] = cause ? [cause.error] : [];
  while (cleanups.length) {
    try { cleanups.pop()!(); }
    catch (error) { failures.push(error); }
  }
  if (failures.length > 1) throw new AggregateError(failures, "Meeko hydration cleanup failed");
  if (failures.length === 1) throw failures[0];
}

/** Añade una lectura de estado a la limpieza de un componente compilado. */
export function withStateSnapshot<Exposed = null>(release: () => void, snapshot: () => Record<string, unknown>, exposed: Exposed = null as Exposed): ComponentRelease<Exposed> {
  return Object.assign(release, { snapshot, exposed });
}

const componentStart = /^meeko:component:\d+(?::.*)?$/;
const snippetStart = /^meeko:snippet:\d+$/;

/**
 * Kind of a region that a search skips: a child component, whose markers belong to it, or a
 * snippet that the child renders, whose markers belong to the parent that wrote it.
 */
function nestedRegion(data: string): "component" | "snippet" | undefined {
  if (componentStart.test(data)) return "component";
  if (snippetStart.test(data)) return "snippet";
  return undefined;
}

function regionEnd(start: Node): Node {
  const kind = nestedRegion((start as Comment).data)!;
  const end = kind === "component" ? /^\/meeko:component:\d+$/ : /^\/meeko:snippet:\d+$/;
  let depth = 0;
  for (let node: Node | null = start; node; node = node.nextSibling) {
    if (node.nodeType !== 8) continue;
    const data = (node as Comment).data;
    if (nestedRegion(data) === kind) depth++;
    else if (end.test(data) && --depth === 0) return node;
  }
  throw new Error(`Missing end marker for ${(start as Comment).data}`);
}

/** Marks an element filled by `html="..."`; its content is the expression's, never Meeko's. */
const htmlMarker = "data-meeko-h";

function visit(scope: DomScope, callback: (node: Node) => boolean): Node | undefined {
  function siblings(first: Node | null, stop: Node | null = null): Node | undefined {
    for (let node = first; node && node !== stop;) {
      if (callback(node)) return node;
      if (node.nodeType === 8 && nestedRegion((node as Comment).data)) {
        const end = regionEnd(node);
        if (callback(end)) return end;
        node = end.nextSibling;
        continue;
      }
      // Inserted HTML may imitate Meeko markers; a search never looks inside it.
      if (node.nodeType === 1 && (node as Element).hasAttribute(htmlMarker)) {
        node = node.nextSibling;
        continue;
      }
      const found = siblings(node.firstChild);
      if (found) return found;
      node = node.nextSibling;
    }
    return undefined;
  }
  return siblings(scope.start?.nextSibling ?? scope.root.firstChild, scope.end ?? null);
}

function findComment(scope: DomScope, data: string): Comment {
  const node = visit(scope, (candidate) => candidate.nodeType === 8 && (candidate as Comment).data === data);
  if (!node) throw new Error(`Missing Meeko marker ${data}`);
  return node as Comment;
}

function findElement(scope: DomScope, name: string): Element {
  const node = visit(scope, (candidate) => candidate.nodeType === 1 && (candidate as Element).hasAttribute(name));
  if (!node) throw new Error(`Missing Meeko target ${name}`);
  return node as Element;
}

function region(scope: DomScope, kind: string, id: number): DomScope {
  const start = findComment(scope, `meeko:${kind}:${id}`);
  const end = findComment(scope, `/meeko:${kind}:${id}`);
  if (start.parentNode !== end.parentNode) throw new Error(`Invalid Meeko region ${kind}:${id}`);
  return { root: scope.root, start, end };
}

function clearRegion(scope: DomScope): void {
  if (!scope.start || !scope.end) throw new Error("Expected a bounded Meeko region");
  for (let node = scope.start.nextSibling; node && node !== scope.end;) {
    const next = node.nextSibling;
    node.parentNode?.removeChild(node);
    node = next;
  }
}

function cloneRegion(scope: DomScope): DocumentFragment {
  if (!scope.start || !scope.end) throw new Error("Expected a bounded Meeko region");
  const range = scope.start.ownerDocument.createRange();
  range.setStartAfter(scope.start);
  range.setEndBefore(scope.end);
  return range.cloneContents();
}

function restoreRegion(scope: DomScope, content: DocumentFragment): void {
  clearRegion(scope);
  scope.end!.parentNode!.insertBefore(content, scope.end!);
}

function insertHtml(end: Comment, html: string): void {
  const parent = end.parentNode;
  if (!parent) throw new Error("Detached Meeko region");
  parent.insertBefore(parseRegionHtml(parent, html), end);
}

const svgNamespace = "http://www.w3.org/2000/svg";

/**
 * Parses HTML rendered by Meeko in the context of `parent`, for a late mount or a navigation.
 * The template's own nodes behave as in 1.0; the `<script>` elements inside `html="..."` content
 * are replaced by inert copies, so they never run, as with `innerHTML` in every other path.
 */
export function parseRegionHtml(parent: Node, html: string): DocumentFragment {
  const document = parent.ownerDocument ?? (parent as Document);
  const range = document.createRange();
  range.selectNodeContents(parent);
  const fragment = range.createContextualFragment(html);
  for (const element of Array.from(fragment.querySelectorAll(`[${htmlMarker}]`))) {
    for (const script of Array.from(element.getElementsByTagName("script"))) {
      // `innerHTML` marks the scripts it parses as already started: they never run once inserted.
      const holder = script.namespaceURI === svgNamespace ? document.createElementNS(svgNamespace, "svg") : document.createElement("div");
      holder.innerHTML = script.outerHTML;
      const copy = holder.firstChild;
      if (copy) script.replaceWith(copy);
      else script.remove();
    }
  }
  return fragment;
}

function sameProps<Props extends object>(first: Props, second: Props, sameFunctions = false): boolean {
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  return firstKeys.length === secondKeys.length && firstKeys.every((key) => {
    if (!Object.hasOwn(second, key)) return false;
    const before = first[key as keyof Props];
    const after = second[key as keyof Props];
    return Object.is(before, after) || (sameFunctions && typeof before === "function" && typeof after === "function");
  });
}

/** A region update failed and restoring its previous content failed too. */
export class RegionRecoveryError extends AggregateError {}

/** Whether a failure left a region that could not be restored, possibly nested in aggregates. */
export function hasRegionRecoveryFailure(error: unknown): boolean {
  return error instanceof RegionRecoveryError
    || (error instanceof AggregateError && error.errors.some(hasRegionRecoveryFailure));
}

/** Marks the empty region of a child that mounts once the data it awaits has loaded. */
const waitingMarker = "meeko:waiting";

/** CSS of the child components that a server document is rendering; see {@link collectStyles}. */
let renderedStyles: Set<string> | undefined;

/**
 * @internal Runs a synchronous server render and adds to `styles` the CSS of every child component
 * it renders, so the document can link it before the client bundle loads.
 */
export function collectStyles<T>(styles: Set<string>, render: () => T): T {
  const previous = renderedStyles;
  renderedStyles = styles;
  try { return render(); }
  finally { renderedStyles = previous; }
}

/** Renderiza un hijo entre comentarios de ámbito sin añadir un elemento visual. */
export function renderComponent<Props extends object>(id: number, component: Component<Props>, props: Props, transferState: boolean): string;
export function renderComponent<Props extends object>(id: number, component: ComponentModule<Props>, props: Props, transferState?: false): string;
export function renderComponent<Props extends object>(id: number, component: ComponentModule<Props>, props: Props, transferState = false): string {
  try { return renderComponentHtml(id, component, props, transferState); }
  catch (error) {
    // A child waiting for data does not stop its siblings: the pass collects every request, then renders again.
    if (isPassSuspension(error)) return `<!--meeko:component:${id}--><!--/meeko:component:${id}-->`;
    // A child that mounts after its page: bindComponent finds the marker and mounts it once its data loads.
    if (isLateSuspension(error)) return `<!--meeko:component:${id}--><!--${waitingMarker}--><!--/meeko:component:${id}-->`;
    throw error;
  }
}

function renderComponentHtml<Props extends object>(id: number, component: ComponentModule<Props>, props: Props, transferState: boolean): string {
  const css = (component as { readonly css?: unknown }).css;
  if (renderedStyles && typeof css === "string" && css) renderedStyles.add(css);
  if (transferState) {
    if (!component.renderWithState) throw new TypeError(`Component ${id} cannot transfer SSR state`);
    const rendered = component.renderWithState(props);
    return `<!--meeko:component:${id}:${encodeURIComponent(serializeJson(rendered.state))}-->${rendered.html}<!--/meeko:component:${id}-->`;
  }
  return `<!--meeko:component:${id}-->${component.renderToString(props)}<!--/meeko:component:${id}-->`;
}

function componentRegion(scope: DomScope, id: number): { inner: DomScope; state?: Record<string, unknown> } {
  const prefix = `meeko:component:${id}`;
  const start = visit(scope, (candidate) => candidate.nodeType === 8 && ((candidate as Comment).data === prefix || (candidate as Comment).data.startsWith(`${prefix}:`))) as Comment | undefined;
  if (!start) throw new Error(`Missing Meeko marker ${prefix}`);
  const end = findComment(scope, `/meeko:component:${id}`);
  if (start.parentNode !== end.parentNode) throw new Error(`Invalid Meeko region component:${id}`);
  const encoded = start.data.slice(prefix.length);
  if (!encoded) return { inner: { root: scope.root, start, end } };
  const parsed: unknown = JSON.parse(decodeURIComponent(encoded.slice(1)));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new TypeError(`Invalid Meeko state for component:${id}`);
  return { inner: { root: scope.root, start, end }, state: parsed as Record<string, unknown> };
}

/** Whether a region holds only the marker of a child that waits for its data. */
function waitingRegion(inner: DomScope): boolean {
  const first = inner.start!.nextSibling;
  return first !== null && first.nodeType === 8 && (first as Comment).data === waitingMarker && first.nextSibling === inner.end;
}

/**
 * Props object of a component tag, typed by the component alone; returns `props` unchanged and
 * never reads `component`. A generic call infers its type argument from an arrow's returned
 * object with widened literals, so `read: () => ({ variant: "primary" })` would not match a prop
 * `variant: "primary" | "secondary"`. As a direct argument the object keeps its literal types and
 * is checked exactly: an unknown prop is an excess property, also beside known ones, a missing
 * required prop is reported and callbacks get their parameter types.
 */
export function componentProps<Props extends object>(component: ComponentModule<Props> | (() => ComponentModule<Props>), props: NoInfer<Props>): Props {
  void component;
  return props;
}

/** Most loads of one deferred mount when its final render still misses data. */
const deferredAttempts = 3;

/**
 * Hidrata un hijo dentro de su rango y actualiza props reactivas con limpieza previa.
 * `expose` receives the `exposed` value of each hydrated instance, with `hydrated` set, and
 * `null` once it is released.
 *
 * A child that awaits data it does not have, because it mounts after its page, leaves its region
 * empty: the binding loads the data in dry passes, then renders and hydrates it. Releasing the
 * binding first cancels the load; a failure goes to the nearest error handler.
 */
export function bindComponent<Props extends object>(scope: DomScope, id: number, input: ComponentModule<Props> | (() => ComponentModule<Props>), read: () => Props, location: string, expose?: (value: unknown, hydrated?: boolean) => void): () => void {
  let inner: DomScope;
  let state: Record<string, unknown> | undefined;
  try {
    ({ inner, state } = componentRegion(scope, id));
  } catch (error) {
    throw new Error(`Hydration mismatch in ${location}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const owner = currentEffectOwner();
  const report = componentErrorReporter("mounted");
  const resolveComponent = (): ComponentModule<Props> => typeof input === "function" ? input() : input;
  const unmounted: ComponentRelease = () => {};
  let component = resolveComponent();
  let props = read();
  let release: ComponentRelease = unmounted;
  /** Cancels the deferred mount in progress. */
  let loading: AbortController | undefined;
  const publish = (): void => expose?.(release.exposed ?? null, true);
  const defer = (target: ComponentModule<Props>, targetProps: Props, targetState: Record<string, unknown> | undefined, attempt = 1): void => {
    const control = new AbortController();
    loading = control;
    const render = (): string => target.renderToString(targetProps, targetState);
    loadDeferred(owner, render, control.signal).then((data) => {
      if (control.signal.aborted) return;
      const restore = switchOwner(owner);
      try {
        let html: string;
        try { html = data.read(() => lateRender(render)); }
        catch (error) {
          if (!isLateSuspension(error) || attempt >= deferredAttempts) throw error;
          // Its data changed meanwhile: load again.
          defer(target, targetProps, targetState, attempt + 1);
          return;
        }
        loading = undefined;
        insertHtml(inner.end!, html);
        try { release = data.read(() => target.hydrateScope(inner, targetProps, targetState)); }
        catch (error) {
          clearRegion(inner);
          throw error;
        }
        data.keep();
        publish();
      } finally { restore(); }
    }).catch((error: unknown) => {
      if (control.signal.aborted) return;
      if (loading === control) loading = undefined;
      report(error);
    });
  };
  if (waitingRegion(inner)) {
    clearRegion(inner);
    defer(component, props, state);
  } else {
    release = component.hydrateScope(inner, props, state);
    publish();
  }
  let stop = () => {};
  let first = true;
  // The onMounted callbacks of a new child run once the whole update has finished.
  stop = effect(() => mountBatch(() => {
    const nextComponent = resolveComponent();
    const next = read();
    // The first run reads the props again only to track them. An inline callback such as
    // `on:save="(id) => save(id)"` is a new function then, but not a new value: keep the hydrated child.
    const initial = first;
    first = false;
    if (nextComponent === component && sameProps(props, next, initial) && sameChannels(props, next)) return;
    // The new component or props replace a deferred mount that has not finished.
    loading?.abort();
    loading = undefined;
    const mounted = release !== unmounted;
    const previousState = release.snapshot?.();
    const state = nextComponent === component ? previousState : undefined;
    let html: string;
    try { html = lateRender(() => nextComponent.renderToString(next, state)); }
    catch (error) {
      if (!isLateSuspension(error)) throw error;
      // It waits for data: release the current child and leave the region empty until the data loads.
      const previousRelease = release;
      release = unmounted;
      component = nextComponent;
      props = next;
      try {
        if (mounted) expose?.(null);
        previousRelease();
      } finally { clearRegion(inner); }
      defer(nextComponent, next, state);
      return;
    }
    const previous = cloneRegion(inner);
    try {
      if (mounted) expose?.(null);
      release();
      release = unmounted;
      clearRegion(inner);
      insertHtml(inner.end!, html);
      const nextRelease = nextComponent.hydrateScope(inner, next, state);
      release = nextRelease;
      component = nextComponent;
      props = next;
      publish();
    } catch (error) {
      try {
        restoreRegion(inner, previous);
        if (mounted) {
          release = component.hydrateScope(inner, props, previousState);
          publish();
        } else defer(component, props, undefined);
      } catch (rollbackError) {
        release = unmounted;
        stop();
        throw new RegionRecoveryError([error, rollbackError], `Meeko component update and recovery failed in ${location}`);
      }
      throw error;
    }
  }));
  return () => {
    loading?.abort();
    loading = undefined;
    stop();
    try { release(); }
    finally { expose?.(null); }
  };
}

/** Publishes the element of a `ref:` directive while its region stays hydrated. */
export function bindElementRef(scope: DomScope, refs: ElementRefs, id: number): () => void {
  const target = findElement(scope, `data-meeko-r-${id}`);
  const publish = refTarget(refs, id);
  publish(target);
  return () => publish(null);
}

/** Conecta un texto reactivo al marcador SSR y comprueba su valor inicial. */
export function bindText(scope: DomScope, id: number, read: () => unknown, location: string, source?: EffectSource): () => void {
  const marker = findComment(scope, `meeko:text:${id}`);
  const initial = String(read());
  let text = marker.nextSibling;
  // HTML parsing drops empty text nodes. Restore only that empty SSR case so
  // adjacent static text stays untouched and the reactive expression can bind.
  if (initial === "" && (!text || text.nodeType !== 3 || text.textContent !== "")) {
    text = marker.ownerDocument.createTextNode("");
    marker.parentNode!.insertBefore(text, marker.nextSibling);
  }
  if (!text || text.nodeType !== 3) throw new Error(`Missing text node in ${location}`);
  if (text.textContent !== initial) throw new Error(`Hydration mismatch in ${location}`);
  let first = true;
  return effect(() => {
    const next = String(read());
    if (first) {
      first = false;
      if (text.textContent === next) return;
    }
    text.textContent = next;
  }, source);
}

/**
 * Whether `target` already shows `html`, parsed in the context of `target` as `innerHTML` would,
 * in an inert document where nothing runs or loads.
 */
function sameHtml(target: Element, html: string): boolean {
  if (target.innerHTML === html) return true;
  return inertElement(target.ownerDocument, target.localName, contentNamespace(target), html).innerHTML === target.innerHTML;
}

/**
 * Conecta `html="expresión"` al elemento SSR. Si su contenido coincide con el HTML de la expresión,
 * la hidratación no toca el DOM; si difiere, sustituye `innerHTML`. Después lo sustituye cada vez que
 * cambia el valor. `innerHTML` nunca ejecuta los `<script>` del contenido. Inseguro con contenido
 * no confiable (XSS).
 */
export function bindHtml(scope: DomScope, id: number, read: () => unknown, location: string, source?: EffectSource): () => void {
  const target = visit(scope, (candidate) => candidate.nodeType === 1 && (candidate as Element).getAttribute(htmlMarker) === String(id)) as Element | undefined;
  if (!target) throw new Error(`Missing Meeko target ${htmlMarker}="${id}" in ${location}`);
  let current: string | undefined;
  return effect(() => {
    // The SSR render types the value; the browser only checks it.
    const next = rawHtml(read() as string | null | undefined);
    if (current === undefined ? sameHtml(target, next) : current === next) {
      current = next;
      return;
    }
    current = next;
    target.innerHTML = next;
  }, source);
}

/** Conecta un atributo dinámico al elemento SSR y comprueba su valor inicial. */
export function bindAttribute(scope: DomScope, id: number, name: string, read: () => unknown, location: string, source?: EffectSource): () => void {
  const target = findElement(scope, `data-meeko-a-${id}`);
  const initial = attributeValue(name, read());
  if (target.getAttribute(name) !== initial) throw new Error(`Hydration mismatch in ${location}`);
  let first = true;
  return effect(() => {
    const next = attributeValue(name, read());
    if (first) {
      first = false;
      if (target.getAttribute(name) === next) {
        // `textarea` and `select` never read a `value` attribute, so SSR cannot
        // show it; apply it once unless the user already changed the control.
        if (name === "value" && pristineValueControl(target)) syncFormState(target, name, next);
        return;
      }
    }
    if (next === null) target.removeAttribute(name);
    else target.setAttribute(name, next);
    syncFormState(target, name, next);
  }, source);
}

/** A `textarea` or single `select` whose value the user has not changed yet. */
function pristineValueControl(target: Element): boolean {
  if (target.localName === "textarea") {
    const control = target as HTMLTextAreaElement;
    return control.value === control.defaultValue;
  }
  if (target.localName !== "select" || (target as HTMLSelectElement).multiple) return false;
  const select = target as HTMLSelectElement;
  const options = Array.from(select.options);
  // Without a `selected` attribute a single select shows its first option.
  // `defaultSelected` reflects the `selected` attribute; read it directly for minimal DOMs.
  const initial = options.filter((option) => option.hasAttribute("selected")).at(-1) ?? options[0];
  return select.selectedIndex === (initial ? options.indexOf(initial) : -1);
}

/**
 * Once the user edits a form control, the browser stops reading its `value`,
 * `checked` or `selected` attribute; the live property must follow the binding.
 */
function syncFormState(target: Element, name: string, next: string | null): void {
  const tag = target.localName;
  if (name === "value" && (tag === "input" || tag === "textarea" || (tag === "select" && !(target as HTMLSelectElement).multiple))) {
    const control = target as HTMLInputElement;
    // Leave an equal value alone so typing keeps the caret where it is.
    if (control.value !== (next ?? "")) control.value = next ?? "";
  } else if (name === "checked" && tag === "input") {
    (target as HTMLInputElement).checked = next !== null;
  } else if (name === "selected" && tag === "option") {
    (target as HTMLOptionElement).selected = next !== null;
  }
}

/** Conecta un evento al elemento SSR y entrega su función de limpieza. */
export function bindEvent(scope: DomScope, id: number, name: string, handler: (event: Event) => void): () => void {
  const target = findElement(scope, `data-meeko-e-${id}`);
  const report = componentErrorReporter();
  const listener = (event: Event) => observeCallback(
    () => handler(event),
    report,
  );
  target.addEventListener(name, listener);
  return () => target.removeEventListener(name, listener);
}

/** Whether the user changed a control after SSR and before hydration. */
function editedControl(target: Element, kind: NativeModelKind): boolean {
  if (kind === "checkbox" || kind === "radio") {
    const control = target as HTMLInputElement;
    return control.checked !== control.defaultChecked;
  }
  if (kind === "multiple") {
    return Array.from((target as HTMLSelectElement).options).some((option) => option.selected !== option.hasAttribute("selected"));
  }
  if (kind === "select") return !pristineValueControl(target);
  const control = target as HTMLInputElement | HTMLTextAreaElement;
  return control.value !== control.defaultValue;
}

/** Writes a model value into the live state of its control. */
function applyModel(target: Element, kind: NativeModelKind, value: unknown, radioValue: string | undefined): void {
  if (kind === "checkbox") syncFormState(target, "checked", value ? "" : null);
  else if (kind === "radio") syncFormState(target, "checked", value === radioValue ? "" : null);
  else if (kind === "multiple") {
    const selected = Array.isArray(value) ? value.map(String) : [];
    for (const option of Array.from((target as HTMLSelectElement).options)) syncFormState(option, "selected", selected.includes(option.value) ? "" : null);
  } else syncFormState(target, "value", value === null || value === undefined ? "" : String(value));
}

/** Writes the live state of a control into its model signal. */
function readControl(target: Element, kind: NativeModelKind, model: { value: unknown }): void {
  if (kind === "checkbox") model.value = (target as HTMLInputElement).checked;
  else if (kind === "radio") {
    const control = target as HTMLInputElement;
    if (control.checked) model.value = control.value;
  } else if (kind === "multiple") {
    model.value = Array.from((target as HTMLSelectElement).options).filter((option) => option.selected).map((option) => option.value);
  } else model.value = (target as HTMLInputElement).value;
}

/**
 * Connects `model="signal"` on a native control in both directions. Writes to the signal update
 * the live property, like a `bind:` attribute after the user edited the control; the control's
 * event writes the signal. A control edited before hydration keeps the user's value and writes it
 * to the signal once the hydration batch ends (`afterMountBatch`), before `onMounted`, so the
 * regions that read the signal hydrate against the SSR value first. `radio` reads the value of the
 * radio, from its attribute or `bind:value`.
 */
export function bindModel<K extends NativeModelKind>(scope: DomScope, id: number, kind: K, read: () => { value: NativeModelValues[K] }, radioValue?: () => unknown): () => void {
  const target = findElement(scope, `data-meeko-m-${id}`);
  const report = componentErrorReporter();
  const writable = (): { value: unknown } => {
    const model = read();
    if (!isWritableSignal(model)) throw new TypeError("Meeko model expects a writable signal, not a computed signal or a plain value");
    return model;
  };
  let model = untrack(writable);
  const edited = editedControl(target, kind);
  // Writing the restored value mid-hydration would change regions that have not hydrated yet;
  // it reaches the signal once the whole hydration batch has finished.
  const cancelRead = edited
    ? afterMountBatch(() => observeCallback(() => readControl(target, kind, model), report))
    : () => {};
  let first = true;
  const stop = effect(() => {
    model = writable();
    const value = model.value;
    const radio = radioValue ? radioValue() : undefined;
    const option = radio === null || radio === undefined ? undefined : String(radio);
    if (first) {
      first = false;
      if (edited) return;
    }
    applyModel(target, kind, value, option);
  });
  const event = kind === "text" ? "input" : "change";
  const listener = (): void => observeCallback(() => readControl(target, kind, model), report);
  target.addEventListener(event, listener);
  return () => {
    cancelRead();
    stop();
    target.removeEventListener(event, listener);
  };
}

/** Genera los límites estables de una condición en SSR. */
export function renderIf(id: number, condition: unknown, render: () => string): string {
  return `<!--meeko:if:${id}-->${condition ? render() : ""}<!--/meeko:if:${id}-->`;
}

/** Hidrata una condición y conserva los nodos mientras sigue siendo verdadera. */
export function bindIf(scope: DomScope, id: number, read: () => unknown, render: () => string, hydrate: (inner: DomScope) => () => void): () => void {
  const inner = region(scope, "if", id);
  let active = Boolean(read());
  if (!active && inner.start?.nextSibling !== inner.end) throw new Error(`Hydration mismatch in condition ${id}`);
  let release = active ? hydrate(inner) : undefined;
  let stop = () => {};
  stop = effect(() => mountBatch(() => {
    const next = Boolean(read());
    if (next === active) return;
    if (next) {
      const html = lateRender(render);
      try {
        clearRegion(inner);
        insertHtml(inner.end!, html);
        release = hydrate(inner);
        active = true;
      } catch (error) {
        try { clearRegion(inner); }
        catch (cleanupError) {
          stop();
          throw new AggregateError([error, cleanupError], `Meeko condition ${id} update and cleanup failed`);
        }
        throw error;
      }
      return;
    }
    const failures: unknown[] = [];
    try { release?.(); }
    catch (error) { failures.push(error); }
    release = undefined;
    try { clearRegion(inner); }
    catch (error) { failures.push(error); stop(); }
    active = false;
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, `Meeko condition ${id} update failed`);
  }));
  return () => { stop(); release?.(); };
}

/**
 * Renders `<render snippet args>`: the parent's snippet content between markers of the child, or
 * an empty region when the parent did not pass that optional snippet.
 */
export function renderSnippet<Args extends readonly unknown[]>(id: number, snippet: Snippet<Args> | undefined, args: NoInfer<Args>): string {
  const data = snippetOf(snippet);
  return `<!--meeko:snippet:${id}-->${data ? data.render(...args) : ""}<!--/meeko:snippet:${id}-->`;
}

function sameArguments(first: readonly unknown[], second: readonly unknown[]): boolean {
  return first.length === second.length && first.every((value, index) => Object.is(value, second[index]));
}

/**
 * Hydrates snippet content in the parent's reactive root, where the snippet was written, while its
 * nodes stay in the child's region. The child releases it with its region; the parent's root
 * releases its effects too if it goes first.
 */
function hydrateSnippet(data: SnippetData, inner: DomScope, args: Signal<readonly unknown[]>): () => void {
  if (!data.hydrate) throw new Error("Meeko snippet cannot hydrate: it was created for SSR only");
  const hydrate = data.hydrate;
  const restore = switchOwner(data.owner);
  try {
    return createRoot((dispose) => {
      const cleanup = hydrate(args, inner);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        finishWithCleanup(cleanup, dispose);
      };
    });
  } finally { restore(); }
}

/**
 * Hydrates `<render snippet args>` in the child. Changed arguments reach the snippet content as a
 * signal, without rendering it again; another snippet replaces the region.
 */
export function bindSnippet(scope: DomScope, id: number, read: () => unknown, readArgs: () => readonly unknown[]): () => void {
  const inner = region(scope, "snippet", id);
  let current: SnippetData | undefined;
  let release: (() => void) | undefined;
  const args = signal<readonly unknown[]>(untrack(readArgs));
  let stopSnippet = () => {};
  let first = true;
  stopSnippet = effect(() => mountBatch(() => {
    const next = snippetOf(read());
    if (first) {
      first = false;
      current = next;
      if (!next && inner.start?.nextSibling !== inner.end) throw new Error(`Hydration mismatch in snippet ${id}`);
      if (next) release = hydrateSnippet(next, inner, args);
      return;
    }
    if (next === current) return;
    const previous = release;
    release = undefined;
    current = next;
    try { previous?.(); }
    finally { clearRegion(inner); }
    if (next) {
      insertHtml(inner.end!, lateRender(() => next.render(...untrack(() => args.value))));
      release = hydrateSnippet(next, inner, args);
    }
  }));
  let stopArgs = () => {};
  try {
    stopArgs = effect(() => {
      const next = readArgs();
      if (!sameArguments(untrack(() => args.value), next)) args.value = next;
    });
  } catch (error) {
    stopSnippet();
    release?.();
    throw error;
  }
  return () => {
    stopArgs();
    stopSnippet();
    release?.();
    release = undefined;
  };
}

/** Convierte una clave de lista en un token seguro para comentarios HTML. */
export function keyToken(key: unknown): string {
  if (typeof key === "number" && Number.isFinite(key)) return `n${encodeURIComponent(String(key)).replaceAll("-", "%2D")}`;
  if (typeof key === "string") return `s${encodeURIComponent(key).replaceAll("-", "%2D")}`;
  throw new TypeError("Meeko list keys must be strings or finite numbers");
}

/**
 * Key of a list without `each:key`: its index. Row `i` keeps its nodes and receives item `i`;
 * rows are only added or removed at the end.
 */
export function indexKey(_item: unknown, index: number): number {
  return index;
}

/** Renderiza una lista con límites identificados por claves únicas. */
export function renderFor<T>(id: number, items: Iterable<T>, keyOf: (item: T, index: number) => string | number, render: (item: T, index: number) => string): string {
  const seen = new Set<string>();
  let html = `<!--meeko:for:${id}-->`;
  let index = 0;
  for (const item of items) {
    const key = keyToken(keyOf(item, index));
    if (seen.has(key)) throw new Error(`Duplicate Meeko list key ${key}`);
    seen.add(key);
    html += `<!--meeko:item:${id}:${key}-->${render(item, index)}<!--/meeko:item:${id}:${key}-->`;
    index++;
  }
  return `${html}<!--/meeko:for:${id}-->`;
}

interface ListEntry<T> {
  key: string;
  start: Comment;
  end: Comment;
  value: Signal<T>;
  index: Signal<number> | undefined;
  release: () => void;
}

function moveRange(start: Comment, end: Comment, before: Node): void {
  const parent = before.parentNode;
  if (!parent) throw new Error("Detached Meeko list");
  if (start.parentNode !== parent || end.parentNode !== parent) throw new Error("Detached Meeko list row");
  const document = before.ownerDocument;
  if (!document) throw new Error("Missing document for Meeko list");
  const originalNext = end.nextSibling;
  const fragment = document.createDocumentFragment();
  for (let node: Node | null = start; node;) {
    const next: Node | null = node.nextSibling;
    fragment.appendChild(node);
    if (node === end) break;
    node = next;
  }
  try { parent.insertBefore(fragment, before); }
  catch (error) {
    try { parent.insertBefore(fragment, originalNext); }
    catch (restoreError) {
      throw new AggregateError([error, restoreError], "Meeko list move and restoration failed");
    }
    throw error;
  }
}

function removeRange(start: Comment, end: Comment): void {
  const parent = start.parentNode;
  if (!parent || end.parentNode !== parent) throw new Error("Detached Meeko list row");
  for (let node: Node | null = start; node;) {
    const next: Node | null = node.nextSibling;
    parent.removeChild(node);
    if (node === end) break;
    node = next;
  }
}

/** Encuentra las posiciones que ya mantienen el orden relativo de la lista anterior. */
function stableListPositions(indices: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous = new Int32Array(indices.length).fill(-1);
  for (let index = 0; index < indices.length; index++) {
    const oldIndex = indices[index]!;
    if (oldIndex < 0) continue;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (indices[tails[middle]!]! < oldIndex) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1]!;
    tails[low] = index;
  }
  const stable = new Set<number>();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]!) stable.add(index);
  return stable;
}

/**
 * Hidrata una lista y reordena regiones por clave sin reemplazar nodos conservados.
 * El compilador desactiva `trackIndex` sólo cuando el cuerpo de hidratación no lee
 * la señal de índice; las llamadas directas conservan la señal por defecto.
 */
export function bindFor<T>(scope: DomScope, id: number, read: () => Iterable<T>, keyOf: (item: T, index: number) => string | number, render: (item: T, index: number) => string, hydrate: (item: Signal<T>, index: Signal<number>, inner: DomScope) => () => void, trackIndex = true): () => void {
  const outer = region(scope, "for", id);
  const entries = new Map<string, ListEntry<T>>();
  const initial = [...read()];
  let currentKeys: string[] = [];
  let cursor = outer.start!.nextSibling;
  try {
    for (let index = 0; index < initial.length; index++) {
      const item = initial[index]!;
      const key = keyToken(keyOf(item, index));
      if (entries.has(key)) throw new Error(`Duplicate Meeko list key ${key}`);
      const startData = `meeko:item:${id}:${key}`;
      const endData = `/meeko:item:${id}:${key}`;
      if (!cursor || cursor.nodeType !== 8 || (cursor as Comment).data !== startData) throw new Error(`Hydration mismatch in list ${id} at key ${key}`);
      const start = cursor as Comment;
      let end = start.nextSibling;
      while (end && (end.nodeType !== 8 || (end as Comment).data !== endData)) end = end.nextSibling;
      if (!end) throw new Error(`Missing end marker for list key ${key}`);
      const value = signal(item);
      const position = trackIndex ? signal(index) : undefined;
      const release = createRoot((dispose) => {
        const cleanup = hydrate(value, position as Signal<number>, { root: scope.root, start, end: end as Comment });
        return () => finishWithCleanup(cleanup, dispose);
      });
      entries.set(key, { key, start, end: end as Comment, value, index: position, release });
      currentKeys.push(key);
      cursor = end.nextSibling;
    }
    if (cursor !== outer.end) throw new Error(`Hydration mismatch in list ${id}: extra nodes`);
  } catch (error) {
    try { releaseAll([...entries.values()].map((entry) => entry.release), { error }); }
    finally { entries.clear(); }
  }
  let initialItems: T[] | undefined = initial;
  let stop = () => {};
  stop = effect(() => mountBatch(() => {
    const items = [...read()];
    if (initialItems) {
      const previous = initialItems;
      initialItems = undefined;
      if (items.length === previous.length && items.every((item, index) =>
        Object.is(item, previous[index]) && keyToken(keyOf(item, index)) === currentKeys[index])) return;
    }
    const nextKeys = items.map((item, index) => keyToken(keyOf(item, index)));
    const nextKeySet = new Set(nextKeys);
    if (nextKeySet.size !== nextKeys.length) throw new Error(`Duplicate Meeko list key in region ${id}`);
    const oldPositions = new Map(currentKeys.map((key, index) => [key, index]));
    const oldIndices = nextKeys.map((key) => oldPositions.get(key) ?? -1);
    const stable = stableListPositions(oldIndices);
    const newRows = items.flatMap((item, index) => entries.has(nextKeys[index]!) ? [] : [{
      key: nextKeys[index]!, index, item,
      html: `<!--meeko:item:${id}:${nextKeys[index]}-->${lateRender(() => render(item, index))}<!--/meeko:item:${id}:${nextKeys[index]}-->`,
    }]);
    const staged = new Map<string, ListEntry<T>>();
    const inserted: Array<{ start: Comment; end: Comment }> = [];
    let moving = false;
    try {
      for (const row of newRows) {
        const marker = outer.end!;
        insertHtml(marker, row.html);
        const end = marker.previousSibling as Comment;
        let start: Node | null = end.previousSibling;
        while (start && (start.nodeType !== 8 || (start as Comment).data !== `meeko:item:${id}:${row.key}`)) start = start.previousSibling;
        if (!start) throw new Error(`Missing new list marker for ${row.key}`);
        inserted.push({ start: start as Comment, end });
        const value = signal(row.item);
        const position = trackIndex ? signal(row.index) : undefined;
        const release = createRoot((dispose) => {
          const cleanup = hydrate(value, position as Signal<number>, { root: scope.root, start: start as Comment, end });
          return () => finishWithCleanup(cleanup, dispose);
        });
        staged.set(row.key, { key: row.key, start: start as Comment, end, value, index: position, release });
      }
      moving = true;
      let before: Node = outer.end!;
      for (let index = items.length - 1; index >= 0; index--) {
        const key = nextKeys[index]!;
        const entry = entries.get(key) ?? staged.get(key)!;
        if ((oldIndices[index] === -1 || !stable.has(index)) && entry.end.nextSibling !== before) {
          moveRange(entry.start, entry.end, before);
        }
        before = entry.start;
      }
    } catch (error) {
      const failures: unknown[] = [error];
      for (const entry of [...staged.values()].reverse()) {
        try { entry.release(); }
        catch (cleanupError) { failures.push(cleanupError); }
      }
      for (const row of inserted.reverse()) {
        try { removeRange(row.start, row.end); }
        catch (cleanupError) { failures.push(cleanupError); }
      }
      if (moving) {
        let before: Node = outer.end!;
        for (let index = currentKeys.length - 1; index >= 0; index--) {
          const entry = entries.get(currentKeys[index]!)!;
          try {
            if (entry.end.nextSibling !== before) moveRange(entry.start, entry.end, before);
            before = entry.start;
          } catch (restoreError) { failures.push(restoreError); }
        }
      }
      if (failures.length > 1) {
        stop();
        throw new AggregateError(failures, `Meeko list ${id} update and cleanup failed`);
      }
      throw error;
    }
    const failures: unknown[] = [];
    for (const [key, entry] of entries) {
      if (nextKeySet.has(key)) continue;
      try { entry.release(); }
      catch (error) { failures.push(error); }
      try { removeRange(entry.start, entry.end); }
      catch (error) { failures.push(error); stop(); }
      entries.delete(key);
    }
    for (const [key, entry] of staged) entries.set(key, entry);
    currentKeys = nextKeys;
    try {
      batch(() => {
        for (let index = 0; index < items.length; index++) {
          const entry = entries.get(nextKeys[index]!)!;
          if (staged.has(entry.key)) continue;
          entry.value.value = items[index]!;
          if (entry.index) entry.index.value = index;
        }
      });
    } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, `Meeko list ${id} update failed`);
  }));
  return () => {
    stop();
    try { releaseAll([...entries.values()].map((entry) => entry.release)); }
    finally { entries.clear(); }
  };
}
