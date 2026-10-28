import { markerRegion, nestedRegionEnd, parseRegionHtml } from "./dom.js";
import type { DomScope } from "./dom.js";
import { componentErrorReporter } from "./component-errors.js";
import { observeCallback } from "./error-observer.js";
import { afterMountBatch } from "./lifecycle.js";
import { effect, untrack } from "./reactivity.js";
import { lateRender } from "./suspense.js";

/**
 * Destino de `<MeekoTeleport to>`: `"body"`, el final de `<body>`, o `"#id"`, el elemento con ese
 * `id`. El id empieza por una letra y sólo lleva letras ASCII, dígitos, `-` y `_`; Meeko lo busca
 * con `getElementById`, nunca como selector CSS ni como HTML.
 *
 * @since 1.5.0
 * @example
 * ```ts
 * import type { MeekoTeleportTarget } from "@meekojs/meeko/framework";
 *
 * const toolbar: MeekoTeleportTarget = "#toolbar";
 * const end: MeekoTeleportTarget = "body";
 * ```
 */
export type MeekoTeleportTarget = "body" | `#${string}`;

/**
 * Props de la etiqueta integrada `<MeekoTeleport>`, que pinta su contenido (el snippet `default`)
 * en otro lugar del documento sin sacarlo del componente que lo declara: conserva su ámbito
 * reactivo, sus eventos, sus snippets, `provide`/`inject`, sus manejadores de errores y el CSS
 * `scoped`. El HTML del servidor ya trae el contenido en su destino.
 *
 * @since 1.5.0
 * @example
 * ```html
 * <script lang="ts">
 * const isMobile = signal(false);
 * function save(): void {}
 * </script>
 * <template>
 *   <MeekoTeleport to="#toolbar" bind:disabled="isMobile.value">
 *     <button type="button" on:click="save">Guardar</button>
 *   </MeekoTeleport>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekoteleport
 */
export interface MeekoTeleportProps {
  /** Destino: `"body"` o `"#id"` de un elemento del documento. */
  to: MeekoTeleportTarget;
  /** Con `true`, el contenido se pinta en su sitio, sin moverse; cambiarlo mueve los mismos nodos. */
  disabled?: boolean;
}

/** `#id` with the identifiers that need no escaping: a letter, then letters, digits, `-` and `_`. */
const idTarget = /^#[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * @internal Whether `value` is a target that `<MeekoTeleport to>` admits: `"body"` or `"#id"`.
 */
export function isTeleportTarget(value: unknown): value is MeekoTeleportTarget {
  return value === "body" || (typeof value === "string" && idTarget.test(value));
}

/** The admitted target, or a TypeError that names what `to` admits. */
function checkedTarget(value: unknown): MeekoTeleportTarget {
  if (isTeleportTarget(value)) return value;
  throw new TypeError(`<MeekoTeleport> to must be "body" or "#id" (a letter, then letters, digits, - or _), not ${JSON.stringify(value) ?? String(value)}`);
}

/** @internal The content of one teleport that the server renders in its target. */
export interface TeleportEntry {
  /** Unique in the document: `<!--meeko:portal-ref:KEY-->` marks its place, `<!--meeko:portal:KEY-->` its content. */
  readonly key: string;
  readonly to: MeekoTeleportTarget;
  /** The content between its portal markers; empty while it renders. */
  html: string;
}

/**
 * @internal The teleports of one server document, in the order of their places in the HTML. A
 * render pass that suspends is discarded with its entries: call `clear` before each pass.
 */
export class TeleportCollector {
  readonly entries: TeleportEntry[] = [];
  private next = 0;

  /** A key that no other teleport of this document uses. */
  key(): string {
    return `t${this.next++}`;
  }

  clear(): void {
    this.entries.length = 0;
    this.next = 0;
  }
}

/** The document that the server is rendering; see {@link collectTeleports}. */
let activeCollector: TeleportCollector | undefined;

/**
 * @internal Runs a synchronous server render whose teleports go to `collector`, so the document
 * can place their content in its targets. Without a collector (a component rendered on its own, or
 * a render in the browser) the content stays in its place and the browser moves it.
 */
export function collectTeleports<T>(collector: TeleportCollector, render: () => T): T {
  const previous = activeCollector;
  activeCollector = collector;
  try { return render(); }
  finally { activeCollector = previous; }
}

/** The markers around a teleport's content: `meeko:portal` in its place, `meeko:portal:KEY` in its target. */
function portal(key: string | undefined, html: string): string {
  const name = key === undefined ? "meeko:portal" : `meeko:portal:${key}`;
  return `<!--${name}-->${html}<!--/${name}-->`;
}

/**
 * Renders `<MeekoTeleport>`. In a server document (see {@link collectTeleports}) the content goes to
 * the collector and its place keeps a reference; disabled, or without a document, the content
 * stays in its place between portal markers.
 */
export function renderTeleport(id: number, to: MeekoTeleportTarget, disabled: boolean | undefined, render: () => string): string {
  const target = checkedTarget(to);
  const collector = activeCollector;
  if (disabled || !collector) return `<!--meeko:teleport:${id}-->${portal(undefined, render())}<!--/meeko:teleport:${id}-->`;
  // The entry takes its place before its content renders, so a teleport inside it comes after it.
  const entry: TeleportEntry = { key: collector.key(), to: target, html: "" };
  collector.entries.push(entry);
  try { entry.html = portal(entry.key, render()); }
  catch (error) {
    collector.entries.splice(collector.entries.indexOf(entry), 1);
    throw error;
  }
  return `<!--meeko:teleport:${id}--><!--meeko:portal-ref:${entry.key}--><!--/meeko:teleport:${id}-->`;
}

/** The element of a target in `document`, or `null` when it does not exist. */
function resolveTarget(document: Document, to: MeekoTeleportTarget): Element | null {
  return to === "body" ? document.body : document.getElementById(to.slice(1));
}

/** The start of the content that the server placed in a target: a child of the target or, failing that, anywhere. */
function findPortal(document: Document, key: string, hint: Element | null): Comment | undefined {
  const data = `meeko:portal:${key}`;
  for (const parent of [hint, document.body]) {
    if (!parent) continue;
    for (const child of Array.from(parent.childNodes)) if (child.nodeType === 8 && (child as Comment).data === data) return child as Comment;
  }
  const walker = document.createTreeWalker(document, 128 /* NodeFilter.SHOW_COMMENT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if ((node as Comment).data === data) return node as Comment;
  return undefined;
}

/** Moves the nodes from `start` to `end`, both included, before `before` in `parent` (at the end without it). */
function moveRange(start: Comment, end: Comment, parent: Node, before: Node | null): void {
  const fragment = start.ownerDocument.createDocumentFragment();
  for (let node: Node | null = start; node;) {
    const next: Node | null = node === end ? null : node.nextSibling;
    fragment.appendChild(node);
    node = next;
  }
  parent.insertBefore(fragment, before);
}

function removeRange(start: Comment, end: Comment): void {
  for (let node: Node | null = start; node;) {
    const next: Node | null = node === end ? null : node.nextSibling;
    node.parentNode?.removeChild(node);
    node = next;
  }
}

/**
 * Hydrates `<MeekoTeleport>`: finds its content in the target (by the key of its place) or in its
 * place, hydrates it in the component that declares it and keeps it where `to` and `disabled` say,
 * moving the same nodes when they change. A move waits for the end of the mount batch, so a target
 * that the same hydration or navigation renders exists by then. Releasing it releases the content
 * and removes its nodes, wherever they are.
 */
export function bindTeleport(scope: DomScope, id: number, readTo: () => MeekoTeleportTarget, readDisabled: () => boolean | undefined, render: () => string, hydrate: (inner: DomScope) => () => void): () => void {
  const outer = markerRegion(scope, "teleport", id);
  const placeStart = outer.start!;
  const placeEnd = outer.end!;
  const document = placeStart.ownerDocument;
  let start: Comment;
  let location: Element | null = null;
  const first = placeStart.nextSibling;
  const reference = first?.nodeType === 8 ? /^meeko:portal-ref:([\w-]+)$/.exec((first as Comment).data)?.[1] : undefined;
  if (reference !== undefined) {
    // The server placed the content in its target: the place only keeps the reference.
    const initial = untrack(readTo);
    const found = findPortal(document, reference, isTeleportTarget(initial) ? resolveTarget(document, initial) : null);
    if (!found) throw new Error(`Hydration mismatch in teleport ${id}: its content ${reference} is not in the document`);
    first!.parentNode!.removeChild(first!);
    start = found;
    location = found.parentNode as Element;
  } else if (first?.nodeType === 8 && /^meeko:portal(?::[\w-]+)?$/.test((first as Comment).data)) {
    // In its place: disabled, rendered without a document, or a target that the server did not find.
    start = first as Comment;
  } else if (first === placeEnd) {
    // A place restored without its content, such as a region that recovers from a failed update.
    placeEnd.parentNode!.insertBefore(parseRegionHtml(placeEnd.parentNode!, portal(undefined, lateRender(render))), placeEnd);
    start = placeStart.nextSibling as Comment;
  } else {
    throw new Error(`Hydration mismatch in teleport ${id}`);
  }
  const end = nestedRegionEnd(start);
  const release = hydrate({ root: scope.root, start, end });
  const report = componentErrorReporter("mounted");
  let warned = false;
  const place = (to: MeekoTeleportTarget, disabled: boolean): void => {
    const target = disabled ? null : resolveTarget(document, to);
    if (!disabled && !target && !warned) {
      warned = true;
      console.warn(`<MeekoTeleport to="${to}">: the target is not in the document, so the content stays in its place`);
    }
    if (target === location) return;
    if (target) moveRange(start, end, target, null);
    else moveRange(start, end, placeEnd.parentNode!, placeEnd);
    location = target;
  };
  let cancel = (): void => {};
  let stop = (): void => {};
  try {
    stop = effect(() => {
      const to = checkedTarget(readTo());
      const disabled = Boolean(readDisabled());
      cancel();
      // A target that the same hydration or navigation renders exists once its batch has finished.
      cancel = afterMountBatch(() => observeCallback(() => place(to, disabled), report));
    });
  } catch (error) {
    release();
    throw error;
  }
  return () => {
    stop();
    cancel();
    try { release(); }
    finally { removeRange(start, end); }
  };
}
