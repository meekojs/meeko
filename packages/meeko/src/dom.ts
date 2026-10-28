import { batch, createRoot, currentEffectOwner, effect, effectInOrder, finishWithCleanup, isWritableSignal, reserveUpdateOrder, signal, switchOwner, untrack } from "./reactivity.js";
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
import { reactiveProps } from "./props.js";
import type { PropsSource } from "./props.js";
import { childIdBase, currentIdBase, withIdBase } from "./ids.js";
import { closeTag, dynamicTagName } from "./dynamic-tag.js";
import type { TagPart } from "./dynamic-tag.js";

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
  /** Renderiza el HTML y captura el estado de sus señales; aquí es obligatorio. */
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
/** The content of a `<MeekoTeleport>`, in its place or in its target; see `teleport.ts`. */
const portalStart = /^meeko:portal(?::[\w-]+)?$/;

/**
 * Kind of a region that a search skips: a child component, whose markers belong to it, a
 * snippet that the child renders, whose markers belong to the parent that wrote it, or the content
 * of a `<MeekoTeleport>`, which its teleport hydrates wherever it is, also inside an element of
 * another component.
 */
function nestedRegion(data: string): "component" | "snippet" | "portal" | undefined {
  if (componentStart.test(data)) return "component";
  if (snippetStart.test(data)) return "snippet";
  if (portalStart.test(data)) return "portal";
  return undefined;
}

function regionEnd(start: Node): Node {
  const kind = nestedRegion((start as Comment).data)!;
  const end = kind === "component" ? /^\/meeko:component:\d+$/ : kind === "snippet" ? /^\/meeko:snippet:\d+$/ : /^\/meeko:portal(?::[\w-]+)?$/;
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

/** The element marked `data-meeko="id"`: every binding of an element (attributes, events, model, ref) shares its number. */
function findMarked(scope: DomScope, id: number): Element {
  const value = String(id);
  const node = visit(scope, (candidate) => candidate.nodeType === 1 && (candidate as Element).getAttribute("data-meeko") === value);
  if (!node) throw new Error(`Missing Meeko element ${id}`);
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
  // The child's useId calls take its position in this template, as bindComponent gives it.
  const at = childIdBase(currentIdBase(), String(id));
  if (transferState) {
    if (!component.renderWithState) throw new TypeError(`Component ${id} cannot transfer SSR state`);
    const rendered = withIdBase(at, () => component.renderWithState!(props));
    return `<!--meeko:component:${id}:${encodeURIComponent(serializeJson(rendered.state))}-->${rendered.html}<!--/meeko:component:${id}-->`;
  }
  return `<!--meeko:component:${id}-->${withIdBase(at, () => component.renderToString(props))}<!--/meeko:component:${id}-->`;
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
 * Whether a compiled module reads its props through the view of `reactiveProps`, so new props can
 * reach a mounted instance in place. Modules compiled before 1.2, and modules written by hand, are
 * rebuilt instead.
 */
function acceptsReactiveProps(component: object): boolean {
  return (component as { readonly __meekoReactiveProps?: unknown }).__meekoReactiveProps === true;
}

/**
 * Hidrata un hijo dentro de su rango y actualiza sus props reactivas.
 * A compiled child keeps its instance, its DOM and its focus: changed props are written into the
 * signals of its props view and only the bindings that read them update, also when a snippet
 * appears or disappears (`<snippet if:when>`). Another component or other models rebuild the range,
 * keeping its editable signals by name, as does a snippet that appears or disappears for a child
 * without reactive props. `expose` receives the `exposed` value of each hydrated instance, with
 * `hydrated` set, and `null` once it is released.
 *
 * A child that awaits data it does not have, because it mounts after its page, leaves its region
 * empty: the binding loads the data in dry passes, then renders and hydrates it. Releasing the
 * binding first cancels the load; a failure goes to the nearest error handler.
 */
export function bindComponent<Props extends object>(scope: DomScope, id: number, input: ComponentModule<Props> | (() => ComponentModule<Props>), read: () => Props, location: string, expose?: (value: unknown, hydrated?: boolean) => void): () => void {
  // The child hydrates first; its props still update before the child reacts on its own.
  const order = reserveUpdateOrder();
  let inner: DomScope;
  let state: Record<string, unknown> | undefined;
  try {
    ({ inner, state } = componentRegion(scope, id));
  } catch (error) {
    throw new Error(`Hydration mismatch in ${location}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const owner = currentEffectOwner();
  const report = componentErrorReporter("mounted");
  // Every render and hydration of the child, also later ones, takes the position it had in SSR.
  const at = childIdBase(currentIdBase(), String(id));
  const resolveComponent = (): ComponentModule<Props> => typeof input === "function" ? input() : input;
  const unmounted: ComponentRelease = () => {};
  let component = resolveComponent();
  let props = read();
  let release: ComponentRelease = unmounted;
  /** Props view of the mounted instance, when its module reads props reactively. */
  let source: PropsSource<Props> | undefined;
  /** Cancels the deferred mount in progress. */
  let loading: AbortController | undefined;
  const publish = (): void => expose?.(release.exposed ?? null, true);
  // The child's setup reads its props and other signals: none of them belongs to the observer that mounts it.
  const hydrateChild = (target: ComponentModule<Props>, targetProps: Props, targetState: Record<string, unknown> | undefined): ComponentRelease => {
    const nextSource = acceptsReactiveProps(target) ? reactiveProps(targetProps) : undefined;
    const hydrated = untrack(() => withIdBase(at, () => target.hydrateScope(inner, nextSource ? nextSource.props : targetProps, targetState)));
    source = nextSource;
    return hydrated;
  };
  const unmount = (): void => {
    release = unmounted;
    source = undefined;
  };
  const defer = (target: ComponentModule<Props>, targetProps: Props, targetState: Record<string, unknown> | undefined, attempt = 1): void => {
    const control = new AbortController();
    loading = control;
    const render = (): string => withIdBase(at, () => target.renderToString(targetProps, targetState));
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
        try { release = data.read(() => hydrateChild(target, targetProps, targetState)); }
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
    release = hydrateChild(component, props, state);
    publish();
  }
  let stop = () => {};
  let first = true;
  // The onMounted callbacks of a new child run once the whole update has finished.
  stop = effectInOrder(order, () => mountBatch(() => {
    const nextComponent = resolveComponent();
    const next = read();
    // The first run reads the props again only to track them. An inline callback such as
    // `on:save="(id) => save(id)"` is a new function then, but not a new value: keep the hydrated child.
    const initial = first;
    first = false;
    // A compiled child with reactive props also receives a snippet that appears or disappears
    // (`<snippet if:when>`) in place: its props view tracks the passed snippets.
    if (nextComponent === component && sameChannels(props, next, source !== undefined)) {
      if (sameProps(props, next, initial) && sameChannels(props, next)) return;
      // A mounted compiled child keeps its DOM: the bindings that read a changed prop update.
      if (source) {
        props = next;
        source.update(next);
        return;
      }
    }
    // The new component or props replace a deferred mount that has not finished.
    loading?.abort();
    loading = undefined;
    const mounted = release !== unmounted;
    const previousState = release.snapshot?.();
    const state = nextComponent === component ? previousState : undefined;
    let html: string;
    try { html = lateRender(() => withIdBase(at, () => nextComponent.renderToString(next, state))); }
    catch (error) {
      if (!isLateSuspension(error)) throw error;
      // It waits for data: release the current child and leave the region empty until the data loads.
      const previousRelease = release;
      unmount();
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
      unmount();
      clearRegion(inner);
      insertHtml(inner.end!, html);
      release = hydrateChild(nextComponent, next, state);
      component = nextComponent;
      props = next;
      publish();
    } catch (error) {
      try {
        restoreRegion(inner, previous);
        if (mounted) {
          release = hydrateChild(component, props, previousState);
          publish();
        } else defer(component, props, undefined);
      } catch (rollbackError) {
        unmount();
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
    source = undefined;
    try { release(); }
    finally { expose?.(null); }
  };
}

/**
 * Replaces `target` with the element of `html` (an opening tag and its closing tag, without
 * content). The children move into the new element with their nodes, so their bindings, the state
 * of their components and the values of their controls survive; the focus stays on the moved node
 * that had it, or on the new element if the old one had it and the new one can take it.
 */
function retag(target: Element, html: string): Element {
  const parent = target.parentNode;
  if (!parent) throw new Error("Detached Meeko element");
  const next = parseRegionHtml(parent, html).firstChild;
  if (!next || next.nodeType !== 1) throw new Error("Invalid Meeko element render");
  const active = target.ownerDocument.activeElement;
  const focused = active === target ? next : active && target.contains(active) ? active : null;
  while (target.firstChild) next.appendChild(target.firstChild);
  parent.replaceChild(next, target);
  const focus = (focused as Partial<HTMLElement> | null)?.focus;
  if (focused && typeof focus === "function") focus.call(focused);
  return next as Element;
}

/** The first element of a region: the element of `<component is>` with a tag. */
function regionElement(inner: DomScope): Element {
  for (let node = inner.start!.nextSibling; node && node !== inner.end; node = node.nextSibling) {
    if (node.nodeType === 1) return node as Element;
  }
  throw new Error("Missing Meeko element in its region");
}

/**
 * Hidrata `<component is>` cuya expresión es siempre una etiqueta, en el elemento marcado
 * `element`. Si la etiqueta cambia, un elemento nuevo sustituye al anterior: sus hijos se mueven
 * dentro con sus nodos, sus enlaces y su estado, el foco se conserva y los enlaces propios del
 * elemento (atributos, eventos, `ref:`, `html` y `bind`) se hidratan de nuevo en él.
 */
export function bindElementTag<const T>(scope: DomScope, element: number, read: () => T, content: boolean, open: (tag: TagPart<T>) => string, hydrate: (tag: TagPart<T>, scope: DomScope) => () => void, location: string): () => void {
  let target = findMarked(scope, element);
  let tag = dynamicTagName(untrack(read), content) as TagPart<T>;
  if (target.localName !== tag) throw new Error(`Hydration mismatch in ${location}: expected <${tag}>, found <${target.localName}>`);
  // The element's bindings hydrate first; the tag still updates before they run.
  const order = reserveUpdateOrder();
  let release = untrack(() => hydrate(tag, scope));
  let stop = () => {};
  stop = effectInOrder(order, () => mountBatch(() => {
    const next = dynamicTagName(read(), content) as TagPart<T>;
    if (next === tag) return;
    untrack(() => {
      const html = open(next) + closeTag(next);
      const previous = release;
      release = () => {};
      previous();
      target = retag(target, html);
      tag = next;
      release = hydrate(next, scope);
    });
  }));
  return () => {
    stop();
    release();
  };
}

/** Element half of {@link bindDynamic}: how the tag renders and hydrates its element. */
export interface DynamicElement<Tag extends string = string> {
  /** Data number of the element. */
  readonly element: number;
  /** The tag has content, so a void tag is an error (MEEK031). */
  readonly content: boolean;
  /** Inside `<svg>`, where `is` only admits components. */
  readonly svg: boolean;
  /** Opening tag with the current attributes. */
  readonly open: (tag: Tag) => string;
  /** The whole element with its content, for a region that held a component. */
  readonly render: (tag: Tag) => string;
  /** Bindings of the element itself (attributes, events, `ref:`, `html`, `bind`), which a new tag hydrates again. */
  readonly hydrate: (tag: Tag, scope: DomScope) => () => void;
  /** Bindings of its content, which stay hydrated while the tag changes: the content moves with its nodes. */
  readonly hydrateContent: (scope: DomScope) => () => void;
}

/**
 * Hidrata `<component is>` cuya expresión puede ser una etiqueta o un componente, dentro del rango
 * de comentarios del componente. Un componente se hidrata como en `bindComponent`; una etiqueta, como
 * en `bindElementTag`. Al pasar de un tipo a otro, el rango se vacía y se monta de nuevo.
 */
export function bindDynamic<const T, Props extends object>(scope: DomScope, id: number, read: () => T, location: string, element: DynamicElement<TagPart<T>>, component: { readonly read: () => Props; readonly expose?: (value: unknown, hydrated?: boolean) => void }): () => void {
  let inner: DomScope;
  try { ({ inner } = componentRegion(scope, id)); }
  catch (error) {
    throw new Error(`Hydration mismatch in ${location}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  // The element or the child hydrates first; the value still updates before they react.
  const order = reserveUpdateOrder();
  // A later swap renders and hydrates in the effect: it takes the position the SSR gave this tag.
  const at = currentIdBase();
  let tag: TagPart<T> | undefined;
  let target: Element | undefined;
  /** The component of the last value that was one, which `bindComponent` keeps while the value is a tag. */
  let last: unknown;
  /** The element's own bindings, or the child component's binding. */
  let release: () => void = () => {};
  /** Bindings of the element's content, which survive a change of tag. */
  let releaseContent: () => void = () => {};
  const mountComponent = (): (() => void) => bindComponent(scope, id, () => {
    const current = read();
    return (typeof current === "string" ? last : current) as ComponentModule<Props>;
  }, component.read, location, component.expose);
  const mountElement = (next: TagPart<T>): void => {
    target = regionElement(inner);
    if (target.localName !== next) throw new Error(`Hydration mismatch in ${location}: expected <${next}>, found <${target.localName}>`);
    releaseContent = element.hydrateContent(inner);
    release = element.hydrate(next, inner);
    tag = next;
  };
  const unmount = (): void => {
    const previous = release;
    const previousContent = releaseContent;
    release = () => {};
    releaseContent = () => {};
    tag = undefined;
    target = undefined;
    try { releaseAll([previousContent, previous]); }
    finally { clearRegion(inner); }
  };
  const initial = untrack(read);
  if (typeof initial === "string") {
    const initialTag = dynamicTagName(initial, element.content, element.svg) as TagPart<T>;
    untrack(() => mountElement(initialTag));
  } else {
    last = initial;
    release = untrack(mountComponent);
  }
  let stop = () => {};
  stop = effectInOrder(order, () => mountBatch(() => {
    const next = read();
    if (typeof next !== "string") {
      if (tag === undefined) {
        // Another component: `bindComponent` replaces it.
        last = next;
        return;
      }
      untrack(() => withIdBase(at, () => {
        unmount();
        last = next;
        let html: string;
        try { html = lateRender(() => withIdBase(childIdBase(at, String(id)), () => (next as ComponentModule<Props>).renderToString(component.read()))); }
        catch (error) {
          if (!isLateSuspension(error)) throw error;
          // `bindComponent` loads its data and mounts it.
          html = `<!--${waitingMarker}-->`;
        }
        insertHtml(inner.end!, html);
        release = mountComponent();
      }));
      return;
    }
    const nextTag = dynamicTagName(next, element.content, element.svg) as TagPart<T>;
    if (nextTag === tag) return;
    untrack(() => withIdBase(at, () => {
      if (tag !== undefined && target) {
        // Element to element: the content moves into the new element and stays hydrated.
        const previous = release;
        release = () => {};
        previous();
        target = retag(target, element.open(nextTag) + closeTag(nextTag));
        tag = nextTag;
        release = element.hydrate(nextTag, inner);
        return;
      }
      unmount();
      insertHtml(inner.end!, lateRender(() => element.render(nextTag)));
      mountElement(nextTag);
    }));
  }));
  return () => {
    stop();
    releaseAll([releaseContent, release]);
  };
}

/**
 * Conecta `bind="obj"` de un elemento: escribe sus atributos, quita los que el objeto deja de
 * tener y comprueba los del SSR al hidratar. `read` devuelve los pares nombre-valor ya resueltos.
 */
export function bindSpread(scope: DomScope, id: number, read: () => ReadonlyArray<readonly [string, string]>, location: string): () => void {
  const target = findMarked(scope, id);
  let current = new Map(read());
  for (const [name, value] of current) {
    if (target.getAttribute(name) !== value) throw new Error(`Hydration mismatch in ${location}: attribute ${name}`);
  }
  let first = true;
  return effect(() => {
    const next = new Map(read());
    if (first) {
      first = false;
      current = next;
      return;
    }
    for (const name of current.keys()) {
      if (next.has(name)) continue;
      target.removeAttribute(name);
      syncFormState(target, name, null);
    }
    for (const [name, value] of next) {
      if (current.get(name) === value && target.getAttribute(name) === value) continue;
      target.setAttribute(name, value);
      syncFormState(target, name, value);
    }
    current = next;
  });
}

/** Publishes the element of a `ref:` directive while its region stays hydrated. */
export function bindElementRef(scope: DomScope, refs: ElementRefs, id: number, element: number): () => void {
  const target = findMarked(scope, element);
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
  const target = findMarked(scope, id);
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
  const target = findMarked(scope, id);
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

/** `<input>` types without a text value; a text `model` cannot bind them. */
const nonTextInputTypes = new Set(["checkbox", "radio", "file", "submit", "reset", "button", "image"]);

/**
 * The error of a text `model` whose `<input>` has a type without a text value. The compiler only
 * allows text-like static types, so this happens when `bind:type` switches to one of them.
 */
function textModelTypeError(target: Element): TypeError | undefined {
  if (target.localName !== "input") return undefined;
  const type = (target as HTMLInputElement).type;
  if (!nonTextInputTypes.has(type)) return undefined;
  return new TypeError(`Meeko model on <input bind:type> binds a text value, so type "${type}" is not supported; use a separate <input type="${type}"> with its own model`);
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
 * radio, from its attribute or `bind:value`. A text model on `<input bind:type>` keeps text
 * semantics whatever the type; a type without a text value (checkbox, radio, file…) is an error.
 */
export function bindModel<K extends NativeModelKind>(scope: DomScope, id: number, kind: K, read: () => { value: NativeModelValues[K] }, radioValue?: () => unknown): () => void {
  const target = findMarked(scope, id);
  const report = componentErrorReporter();
  const writable = (): { value: unknown } => {
    const model = read();
    if (!isWritableSignal(model)) throw new TypeError("Meeko model expects a writable signal, not a computed signal or a plain value");
    return model;
  };
  let model = untrack(writable);
  // A text model on `<input bind:type>`: a type without a text value fails the hydration, and
  // later reports to the error observer, leaving the signal and the control as they are.
  const typeError = (): TypeError | undefined => kind === "text" ? textModelTypeError(target) : undefined;
  const initialError = typeError();
  if (initialError) throw initialError;
  const readModel = (): void => {
    const error = typeError();
    if (error) throw error;
    readControl(target, kind, model);
  };
  const edited = editedControl(target, kind);
  // Writing the restored value mid-hydration would change regions that have not hydrated yet;
  // it reaches the signal once the whole hydration batch has finished.
  const cancelRead = edited
    ? afterMountBatch(() => observeCallback(readModel, report))
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
    const error = typeError();
    if (error) report(error);
    else applyModel(target, kind, value, option);
  });
  const event = kind === "text" ? "input" : "change";
  const listener = (): void => observeCallback(readModel, report);
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
  // Its content hydrates first; the condition still updates before that content does.
  const order = reserveUpdateOrder();
  // Content that appears later renders at the position of this template, as in SSR.
  const at = currentIdBase();
  let active = Boolean(read());
  if (!active && inner.start?.nextSibling !== inner.end) throw new Error(`Hydration mismatch in condition ${id}`);
  let release = active ? hydrate(inner) : undefined;
  let stop = () => {};
  stop = effectInOrder(order, () => mountBatch(() => {
    const next = Boolean(read());
    if (next === active) return;
    if (next) {
      const html = withIdBase(at, () => lateRender(render));
      try {
        clearRegion(inner);
        insertHtml(inner.end!, html);
        release = withIdBase(at, () => hydrate(inner));
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
  const content = data ? withIdBase(childIdBase(currentIdBase(), `s${id}`), () => data.render(...args)) : "";
  return `<!--meeko:snippet:${id}-->${content}<!--/meeko:snippet:${id}-->`;
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
  const at = childIdBase(currentIdBase(), `s${id}`);
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
      if (next) release = withIdBase(at, () => hydrateSnippet(next, inner, args));
      return;
    }
    if (next === current) return;
    const previous = release;
    release = undefined;
    current = next;
    try { previous?.(); }
    finally { clearRegion(inner); }
    if (next) {
      insertHtml(inner.end!, withIdBase(at, () => lateRender(() => next.render(...untrack(() => args.value)))));
      release = withIdBase(at, () => hydrateSnippet(next, inner, args));
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
    const row = withIdBase(childIdBase(currentIdBase(), `f${id}${key}`), () => render(item, index));
    html += `<!--meeko:item:${id}:${key}-->${row}<!--/meeko:item:${id}:${key}-->`;
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
  // The rows hydrate first; the list still updates (and drops rows) before their bindings run.
  const order = reserveUpdateOrder();
  // Each row renders and hydrates at the position of its key, as in SSR.
  const parent = currentIdBase();
  const rowAt = (key: string) => childIdBase(parent, `f${id}${key}`);
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
        const cleanup = withIdBase(rowAt(key), () => hydrate(value, position as Signal<number>, { root: scope.root, start, end: end as Comment }));
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
  stop = effectInOrder(order, () => mountBatch(() => {
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
      html: `<!--meeko:item:${id}:${nextKeys[index]}-->${withIdBase(rowAt(nextKeys[index]!), () => lateRender(() => render(item, index)))}<!--/meeko:item:${id}:${nextKeys[index]}-->`,
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
          const cleanup = withIdBase(rowAt(row.key), () => hydrate(value, position as Signal<number>, { root: scope.root, start: start as Comment, end }));
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

/**
 * @internal The region between `<!--meeko:kind:id-->` and `<!--/meeko:kind:id-->` in `scope`, for
 * bindings that live outside this module, such as `<MeekoTeleport>`.
 */
export function markerRegion(scope: DomScope, kind: string, id: number): DomScope {
  return region(scope, kind, id);
}

/** @internal The end marker of the nested region (a child component, a snippet or a portal) that `start` opens. */
export function nestedRegionEnd(start: Comment): Comment {
  return regionEnd(start) as Comment;
}
