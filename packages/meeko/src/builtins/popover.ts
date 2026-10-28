/**
 * `<MeekoPopover>`: what `MeekoPopover.meeko` needs besides its template. The pure helpers (the
 * position area of a placement, the fallback position, the keys of a menu, typeahead) are tested on
 * their own; `createPopover` wires them to the elements once the component is mounted.
 *
 * Nothing here runs on the server but the computed values that the template reads: the content is
 * hidden by its `popover` attribute from the first byte, and every style is applied through CSSOM
 * in the browser, so a strict CSP without `'unsafe-inline'` is enough.
 */
import { computed, effect, untrack } from "../reactivity.js";
import type { ReadonlySignal, Signal } from "../reactivity.js";

/** Lado del disparador en el que se abre el contenido. */
export type PopoverSide = "top" | "bottom" | "left" | "right";

/**
 * Posición del contenido respecto al disparador: un lado y, opcionalmente, la alineación con su
 * borde inicial (`-start`) o final (`-end`). `"bottom-start"` abre debajo, alineado a la izquierda.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoPopover placement="right-start"><snippet name="trigger">Más</snippet>…</MeekoPopover>
 * ```
 */
export type PopoverPlacement = PopoverSide | `${PopoverSide}-start` | `${PopoverSide}-end`;

/**
 * Comportamiento del contenido, el valor de su atributo `popover`: `"auto"` se cierra al pulsar
 * fuera y con `Esc`; `"manual"` sólo se cierra desde el disparador, `Esc` o el modelo; `"hint"` es
 * un tooltip que se abre al pasar el puntero o al enfocar el disparador, sin robar el foco.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoPopover mode="hint"><snippet name="trigger">?</snippet>Ayuda contextual</MeekoPopover>
 * ```
 */
export type PopoverMode = "auto" | "manual" | "hint";

/**
 * Patrón ARIA del contenido: `"menu"` (con `menuitem`, flechas y búsqueda por letras),
 * `"dialog"` (el foco entra en el contenido) o `"tooltip"` (por defecto con `mode="hint"`).
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoPopover role="dialog" label="Filtros"><snippet name="trigger">Filtrar</snippet>…</MeekoPopover>
 * ```
 */
export type PopoverRole = "menu" | "dialog" | "tooltip";

/**
 * Atributos del disparador propio de `<MeekoPopover>`, el parámetro `trigger` del snippet `anchor`.
 * Cada clave es el nombre del atributo, así que el objeto sirve tal cual para `bind="trigger"`, en un
 * elemento o en un componente propio como `<AppButton bind="trigger">` que declare esas props y las
 * ponga en su botón. `<MeekoPopover>` encuentra el elemento por su `id` al montarse y le añade el
 * teclado y el anclaje.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoPopover role="menu">
 *   <snippet name="anchor" params="trigger">
 *     <button type="button" class="avatar" bind="trigger"><img src="/me.png" alt="Mi cuenta"></button>
 *   </snippet>
 *   <button role="menuitem">Perfil</button>
 * </MeekoPopover>
 * ```
 */
export interface PopoverTrigger {
  /** `id` del disparador: `<MeekoPopover>` lo busca con él para anclar el contenido. */
  readonly id: string;
  /** `popovertarget` para un `<button>`: abre y cierra el contenido sin JavaScript. Sin valor con `mode="hint"`. */
  readonly popovertarget: string | undefined;
  /** `aria-controls`: el `id` del contenido. Sin valor con `mode="hint"`. */
  readonly "aria-controls": string | undefined;
  /** `aria-expanded`: `"true"` mientras el contenido está abierto. Sin valor con `mode="hint"`. */
  readonly "aria-expanded": "true" | "false" | undefined;
  /** `aria-haspopup` según `role`: `"menu"` o `"dialog"`. */
  readonly "aria-haspopup": "menu" | "dialog" | undefined;
  /** `aria-describedby` de un tooltip (`mode="hint"`): el `id` del contenido. */
  readonly "aria-describedby": string | undefined;
}

/**
 * Detalle del evento `toggle` de `<MeekoPopover>`, que se emite cada vez que el contenido se abre
 * o se cierra, por el usuario o por el modelo.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoPopover on:toggle="(event) => opened.value = event.open">…</MeekoPopover>
 * ```
 */
export interface PopoverToggleEvent {
  /** `true` si el contenido acaba de abrirse. */
  readonly open: boolean;
}

/**
 * Snippets de `<MeekoPopover>`: el contenido suelto (`default`) va dentro del elemento con
 * `popover`; `trigger` es el contenido del `<button>` disparador que pinta Meeko, y `anchor`
 * sustituye ese botón por un disparador propio, con sus atributos en el parámetro.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoPopover><snippet name="trigger">Opciones ▾</snippet><p>Contenido</p></MeekoPopover>
 * ```
 */
export interface PopoverSnippets {
  /** El contenido del popover. */
  default?: [];
  /** El contenido del `<button>` disparador que pinta Meeko. */
  trigger?: [];
  /** Un disparador propio, en lugar del botón: recibe sus atributos en {@link PopoverTrigger}. */
  anchor?: [trigger: PopoverTrigger];
}

/**
 * Props de la etiqueta propia `<MeekoPopover>`: un contenido en la capa superior (`popover`),
 * anclado a su disparador con *CSS anchor positioning* y con un cálculo en JavaScript donde el
 * navegador no lo tiene. El modelo por defecto (`model="open"`) es la señal de apertura. Se
 * autoimporta en `app/` como el resto de tipos de las etiquetas.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoPopover placement="bottom-start" bind:offset="8" model="open" role="menu">
 *   <snippet name="trigger">Opciones ▾</snippet>
 *   <button role="menuitem" on:click="rename">Renombrar</button>
 *   <button role="menuitem" on:click="remove">Eliminar</button>
 * </MeekoPopover>
 * ```
 */
export interface MeekoPopoverProps {
  /** `"auto"` (por defecto), `"manual"` o `"hint"`; véase {@link PopoverMode}. */
  readonly mode?: PopoverMode;
  /** Dónde se abre respecto al disparador; `"bottom-start"` por defecto. */
  readonly placement?: PopoverPlacement;
  /** Separación en píxeles entre el disparador y el contenido; `0` por defecto. */
  readonly offset?: number;
  /** Patrón ARIA del contenido; con `mode="hint"`, `"tooltip"` por defecto. */
  readonly role?: PopoverRole;
  /** `aria-label` del contenido. Sin ella, un menú o un diálogo se nombran con el disparador. */
  readonly label?: string;
  /** Clases del contenido, el elemento con `popover`. */
  readonly class?: string;
  /** Clases del `<button>` disparador que pinta Meeko. */
  readonly triggerClass?: string;
  /** `id` del disparador; por defecto, uno de `useId`. Con un disparador propio, el `id` que lleva. */
  readonly triggerId?: string;
  /** Con `true`, el contenido mide al menos lo que el disparador (`anchor-size(width)`). */
  readonly matchWidth?: boolean;
  /** Con `mode="hint"`, milisegundos que el puntero espera sobre el disparador antes de abrir; `300` por defecto. */
  readonly delay?: number;
  /** Con `mode="hint"`, milisegundos antes de cerrar al salir el puntero; `150` por defecto. */
  readonly closeDelay?: number;
}

/**
 * Lo que `<MeekoPopover>` expone a una `ref:` del padre: abrir, cerrar y alternar desde código.
 * @since 1.5.0
 * @example
 * ```ts
 * const menu = useElementRef("menu");
 * function openMenu(): void { menu.value?.show(); }
 * ```
 */
export interface PopoverExposed {
  /** Abre el contenido. */
  show(): void;
  /** Cierra el contenido. */
  hide(): void;
  /** Abre el contenido si está cerrado y lo cierra si está abierto. */
  toggle(): void;
}

/** `position-area` of each placement: the side, and the span that aligns it with an edge. */
const areas: Readonly<Record<PopoverPlacement, string>> = {
  top: "top", "top-start": "top span-right", "top-end": "top span-left",
  bottom: "bottom", "bottom-start": "bottom span-right", "bottom-end": "bottom span-left",
  left: "left", "left-start": "left span-bottom", "left-end": "left span-top",
  right: "right", "right-start": "right span-bottom", "right-end": "right span-top",
};

/** A placement of the list, or `"bottom-start"`. */
export function popoverPlacement(value: unknown): PopoverPlacement {
  return typeof value === "string" && Object.hasOwn(areas, value) ? value as PopoverPlacement : "bottom-start";
}

/** The `position-area` of a placement, for CSS anchor positioning. */
export function placementArea(placement: PopoverPlacement): string {
  return areas[placement];
}

/** The margin of the content that separates it from the trigger: on the side that faces it. */
export function placementMargin(placement: PopoverPlacement, offset: number): string {
  const gap = Number.isFinite(offset) && offset > 0 ? `${offset}px` : "0px";
  const side = placement.split("-")[0] as PopoverSide;
  return side === "bottom" ? `${gap} 0px 0px 0px` : side === "top" ? `0px 0px ${gap} 0px` : side === "right" ? `0px 0px 0px ${gap}` : `0px ${gap} 0px 0px`;
}

/** A rectangle of the viewport, as `getBoundingClientRect()` gives it. */
export interface PopoverRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The fallback position of the content when the browser has no CSS anchor positioning: on the side
 * of the placement, or the opposite one when it does not fit and the opposite fits better (as
 * `flip-block` and `flip-inline`), aligned as asked and kept inside the viewport.
 */
export function computePopoverPosition(anchor: PopoverRect, floating: { readonly width: number; readonly height: number }, viewport: { readonly width: number; readonly height: number }, placement: PopoverPlacement, offset: number): { x: number; y: number; side: PopoverSide } {
  const gap = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const [requested, align] = placement.split("-") as [PopoverSide, "start" | "end" | undefined];
  const vertical = requested === "top" || requested === "bottom";
  const opposite: Record<PopoverSide, PopoverSide> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  /** Free space on a side of the anchor. */
  const room = (side: PopoverSide): number => side === "bottom" ? viewport.height - (anchor.top + anchor.height) - gap
    : side === "top" ? anchor.top - gap : side === "right" ? viewport.width - (anchor.left + anchor.width) - gap : anchor.left - gap;
  const size = vertical ? floating.height : floating.width;
  let side = requested;
  if (room(requested) < size && room(opposite[requested]) > room(requested)) side = opposite[requested];
  const clamp = (value: number, max: number): number => Math.max(0, Math.min(value, Math.max(0, max)));
  if (vertical) {
    const y = side === "bottom" ? anchor.top + anchor.height + gap : anchor.top - gap - floating.height;
    const x = align === "start" ? anchor.left : align === "end" ? anchor.left + anchor.width - floating.width : anchor.left + (anchor.width - floating.width) / 2;
    return { x: clamp(x, viewport.width - floating.width), y: clamp(y, viewport.height - floating.height), side };
  }
  const x = side === "right" ? anchor.left + anchor.width + gap : anchor.left - gap - floating.width;
  const y = align === "start" ? anchor.top : align === "end" ? anchor.top + anchor.height - floating.height : anchor.top + (anchor.height - floating.height) / 2;
  return { x: clamp(x, viewport.width - floating.width), y: clamp(y, viewport.height - floating.height), side };
}

/** Text for typeahead and search: lowercase and without accents (`"Árbol"` → `"arbol"`). */
export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The item that typeahead reaches: the first one after `current` (wrapping around) whose label
 * starts with `query`, skipping those that `skip` leaves out. With the same letter repeated
 * (`"aa"`), it cycles through the items that start with that letter. `-1` when none matches.
 */
export function typeaheadIndex(labels: readonly string[], query: string, current: number, skip: (index: number) => boolean = () => false): number {
  const wanted = normalizeText(query);
  if (!wanted || !labels.length) return -1;
  const same = [...wanted].every((letter) => letter === wanted[0]);
  const needle = same ? wanted[0]! : wanted;
  // A longer query keeps the current item while it still matches; a new or repeated letter moves on.
  const start = current < 0 ? 0 : current + (same ? 1 : 0);
  for (let step = 0; step < labels.length; step++) {
    const index = (start + step) % labels.length;
    if (!skip(index) && normalizeText(labels[index]!.trim()).startsWith(needle)) return index;
  }
  return -1;
}

/**
 * The item that a key moves to in a list of `count` items from `current`: the arrows (wrapping
 * when `wrap`), `Home`, `End`, `PageUp` and `PageDown` (ten items), skipping those that `skip`
 * leaves out. `undefined` for any other key.
 */
export function listKeyTarget(key: string, current: number, count: number, skip: (index: number) => boolean = () => false, wrap = true): number | undefined {
  if (count === 0) return undefined;
  const first = (from: number, direction: 1 | -1): number => {
    for (let index = from; index >= 0 && index < count; index += direction) if (!skip(index)) return index;
    return -1;
  };
  const step = (direction: 1 | -1): number => {
    for (let moved = 1; moved <= count; moved++) {
      let index = current + direction * moved;
      if (index < 0 || index >= count) {
        if (!wrap) return current;
        index = (index + count) % count;
      }
      if (!skip(index)) return index;
    }
    return current;
  };
  switch (key) {
    case "ArrowDown": return current < 0 ? first(0, 1) : step(1);
    case "ArrowUp": return current < 0 ? first(count - 1, -1) : step(-1);
    case "Home": return first(0, 1);
    case "End": return first(count - 1, -1);
    case "PageDown": { const target = first(Math.min(count - 1, Math.max(current, 0) + 10), -1); return target < 0 ? first(0, 1) : target; }
    case "PageUp": { const target = first(Math.max(0, current - 10), 1); return target < 0 ? first(count - 1, -1) : target; }
    default: return undefined;
  }
}

/** A printable key for typeahead: one character, without Control, Alt or Meta. */
export function typeaheadKey(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey">): boolean {
  return event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.altKey && !event.metaKey;
}

/** The typed characters of a typeahead, cleared after half a second without a key. */
export function createTypeahead(): { push(key: string): string; clear(): void } {
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    push(key) {
      if (timer !== undefined) clearTimeout(timer);
      buffer += key;
      timer = setTimeout(() => { buffer = ""; timer = undefined; }, 500);
      return buffer;
    },
    clear() {
      if (timer !== undefined) clearTimeout(timer);
      buffer = "";
      timer = undefined;
    },
  };
}

/**
 * The style that anchors every `<MeekoPopover>`, in the `meeko` cascade layer so that any rule of
 * the application wins. It reaches the page as a constructed style sheet (`adoptedStyleSheets`),
 * which a CSP without `'unsafe-inline'` allows; each popover passes its own values in custom
 * properties set through CSSOM. Browsers without anchor positioning ignore those declarations and
 * use the fallback rule, whose position the script computes.
 */
export const popoverStyle = "@layer meeko{"
  + "[data-meeko-popover]{inset:auto;margin:var(--meeko-popover-margin,0);position-anchor:var(--meeko-popover-anchor);position-area:var(--meeko-popover-area,bottom span-right);position-try-fallbacks:flip-block,flip-inline}"
  + "[data-meeko-popover][data-match-width]{min-width:anchor-size(width)}"
  + "[data-meeko-popover][data-meeko-popover-fallback]{position:fixed;margin:0;left:var(--meeko-popover-x,0px);top:var(--meeko-popover-y,0px)}"
  + "[data-meeko-popover][data-meeko-popover-fallback][data-match-width]{min-width:var(--meeko-popover-anchor-width,auto)}"
  + "}";

const adopted = new WeakMap<Document, Set<string>>();

/**
 * Adds a style sheet to `document` once per key, as a constructed sheet. Built-in components share
 * it: `<MeekoSelect>` adds its own rules under another key. A document without constructable
 * style sheets (an old browser, a test DOM) keeps the content working, without that style.
 */
export function adoptStyle(document: Document, key: string, css: string): void {
  const keys = adopted.get(document) ?? new Set<string>();
  if (keys.has(key)) return;
  keys.add(key);
  adopted.set(document, keys);
  const view = document.defaultView as (Window & { CSSStyleSheet?: typeof CSSStyleSheet }) | null;
  const Sheet = view?.CSSStyleSheet;
  if (!Sheet || !("adoptedStyleSheets" in document)) return;
  try {
    const sheet = new Sheet();
    if (typeof sheet.replaceSync !== "function") return;
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    // Without constructable style sheets the content still opens, at the browser's default place.
  }
}

/** Whether the browser of `view` has CSS anchor positioning. */
export function supportsAnchorPositioning(view: Window | null): boolean {
  const css = (view as (Window & { CSS?: { supports?: (property: string, value: string) => boolean } }) | null)?.CSS;
  try { return typeof css?.supports === "function" && css.supports("position-area", "bottom") && css.supports("anchor-name", "--a"); }
  catch { return false; }
}

/** Whether a popover element is open (`:popover-open`, or the flag of a DOM without it). */
export function popoverOpen(element: Element): boolean {
  try { return element.matches(":popover-open"); }
  catch { return element.hasAttribute("data-meeko-popover-open"); }
}

/** Whether an element could take the focus. */
function focusable(element: Element): element is HTMLElement {
  const node = element as HTMLElement;
  if (node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true" || node.hidden) return false;
  return node.tabIndex >= 0 || node.hasAttribute("tabindex") || /^(?:a|button|input|select|textarea)$/.test(node.localName);
}

/** The items of a menu: its `menuitem`, `menuitemcheckbox` and `menuitemradio`, in order. */
export function menuItems(content: ParentNode): HTMLElement[] {
  return [...content.querySelectorAll<HTMLElement>("[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]")];
}

/** What the template of `<MeekoPopover>` reads and the component runs. */
export interface PopoverController {
  readonly triggerId: ReadonlySignal<string>;
  readonly contentId: string;
  readonly mode: ReadonlySignal<PopoverMode>;
  readonly role: ReadonlySignal<PopoverRole | undefined>;
  readonly labelledBy: ReadonlySignal<string | undefined>;
  readonly placement: ReadonlySignal<PopoverPlacement>;
  readonly trigger: ReadonlySignal<PopoverTrigger>;
  /** Attaches the behavior to the mounted elements; returns its cleanup. */
  mount(content: HTMLElement | null): () => void;
  show(): void;
  hide(): void;
  toggle(): void;
}

/**
 * The state of a `<MeekoPopover>`: the IDs and ARIA attributes the template renders (the same in
 * SSR and hydration, from `useId`), and the behavior that `mount` attaches in the browser.
 */
export function createPopover(props: MeekoPopoverProps, open: Signal<boolean>, id: string, emit: (open: boolean) => void): PopoverController {
  const contentId = `${id}-content`;
  const triggerId = computed(() => props.triggerId ?? `${id}-trigger`);
  const mode = computed((): PopoverMode => props.mode === "manual" || props.mode === "hint" ? props.mode : "auto");
  const role = computed((): PopoverRole | undefined => props.role === "menu" || props.role === "dialog" || props.role === "tooltip" ? props.role : mode.value === "hint" ? "tooltip" : undefined);
  const labelledBy = computed(() => props.label === undefined && (role.value === "menu" || role.value === "dialog") ? triggerId.value : undefined);
  const placement = computed(() => popoverPlacement(props.placement));
  const trigger = computed((): PopoverTrigger => {
    const hint = mode.value === "hint";
    return {
      id: triggerId.value,
      popovertarget: hint ? undefined : contentId,
      "aria-controls": hint ? undefined : contentId,
      "aria-expanded": hint ? undefined : open.value ? "true" : "false",
      "aria-haspopup": role.value === "menu" || role.value === "dialog" ? role.value : undefined,
      "aria-describedby": hint ? contentId : undefined,
    };
  });
  let element: HTMLElement | null = null;
  /** Where the focus goes when a menu opens: its first or last item. */
  let pending: "first" | "last" = "first";
  const show = (): void => {
    if (!element) { open.value = true; return; }
    if (!popoverOpen(element) && element.isConnected) {
      try { element.showPopover(); }
      catch { /* Already open, or a disconnected element: nothing to show. */ }
    }
  };
  const hide = (): void => {
    if (!element) { open.value = false; return; }
    if (popoverOpen(element)) {
      try { element.hidePopover(); }
      catch { /* Already closed. */ }
    }
  };
  const toggle = (): void => {
    if (element ? popoverOpen(element) : open.value) hide();
    else show();
  };

  const mount = (content: HTMLElement | null): (() => void) => {
    if (!content) return () => {};
    element = content;
    const document = content.ownerDocument;
    const view = document.defaultView;
    adoptStyle(document, "popover", popoverStyle);
    const fallback = !supportsAnchorPositioning(view);
    if (fallback) content.setAttribute("data-meeko-popover-fallback", "");
    const anchorName = `--meeko-${id}`;
    content.style.setProperty("--meeko-popover-anchor", anchorName);
    const releases: Array<() => void> = [];
    const listen = <K extends string>(target: EventTarget, type: K, listener: (event: Event) => void, options?: AddEventListenerOptions): void => {
      target.addEventListener(type, listener, options);
      releases.push(() => target.removeEventListener(type, listener, options));
    };
    let anchor: HTMLElement | null = null;
    /** The trigger, found by its id; again when the anchor snippet replaced it. */
    const triggerElement = (): HTMLElement | null => {
      if (anchor?.isConnected && anchor.id === untrack(() => triggerId.value)) return anchor;
      anchor = document.getElementById(untrack(() => triggerId.value));
      if (anchor) attachTrigger(anchor);
      return anchor;
    };
    const attached = new WeakSet<HTMLElement>();

    // Position: the custom properties of the anchored style, or the fallback's computed place.
    releases.push(effect(() => {
      content.style.setProperty("--meeko-popover-area", placementArea(placement.value));
      content.style.setProperty("--meeko-popover-margin", placementMargin(placement.value, props.offset ?? 0));
    }));
    let frame: number | undefined;
    const place = (): void => {
      frame = undefined;
      const target = triggerElement();
      if (!fallback || !target || !popoverOpen(content)) return;
      const box = target.getBoundingClientRect();
      content.style.setProperty("--meeko-popover-anchor-width", `${box.width}px`);
      const size = content.getBoundingClientRect();
      const viewport = { width: document.documentElement.clientWidth || view?.innerWidth || 0, height: document.documentElement.clientHeight || view?.innerHeight || 0 };
      const position = computePopoverPosition(box, size, viewport, untrack(() => placement.value), untrack(() => props.offset ?? 0));
      content.style.setProperty("--meeko-popover-x", `${Math.round(position.x)}px`);
      content.style.setProperty("--meeko-popover-y", `${Math.round(position.y)}px`);
      content.setAttribute("data-side", position.side);
    };
    const schedule = (): void => {
      if (!fallback || frame !== undefined) return;
      frame = view?.requestAnimationFrame ? view.requestAnimationFrame(place) : (place(), undefined);
    };
    let tracking: (() => void) | undefined;
    const track = (): void => {
      if (!fallback || tracking || !view) return;
      const onChange = (): void => schedule();
      view.addEventListener("resize", onChange);
      view.addEventListener("scroll", onChange, { capture: true, passive: true });
      const Observer = (view as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
      const observer = Observer ? new Observer(onChange) : undefined;
      observer?.observe(content);
      tracking = () => {
        view.removeEventListener("resize", onChange);
        view.removeEventListener("scroll", onChange, { capture: true });
        observer?.disconnect();
      };
    };
    const untrackPosition = (): void => {
      tracking?.();
      tracking = undefined;
    };
    releases.push(untrackPosition, () => { if (frame !== undefined) view?.cancelAnimationFrame?.(frame); });

    /** Moves the focus into an opened menu or dialog. */
    const focusInside = (): void => {
      const kind = untrack(() => role.value);
      if (kind === "menu") {
        const items = menuItems(content).filter(focusable);
        for (const item of menuItems(content)) if (!item.hasAttribute("tabindex")) item.tabIndex = -1;
        const target = pending === "last" ? items.at(-1) : items[0];
        target?.focus();
      } else if (kind === "dialog") {
        const target = content.querySelector<HTMLElement>("[autofocus]") ?? [...content.querySelectorAll<HTMLElement>("a[href],button,input,select,textarea,[tabindex]")].find((node) => focusable(node) && node.tabIndex >= 0);
        (target ?? content).focus();
      }
      pending = "first";
    };
    /** Closes and gives the focus back to the trigger. */
    const closeToTrigger = (): void => {
      hide();
      triggerElement()?.focus();
    };
    let last = untrack(() => open.value);
    const synced = (now: boolean): void => {
      if (open.value !== now) open.value = now;
      if (now === last) return;
      last = now;
      if (now) {
        content.setAttribute("data-open", "");
        schedule();
        track();
        if (untrack(() => mode.value) !== "hint") focusInside();
      } else {
        content.removeAttribute("data-open");
        untrackPosition();
      }
      emit(now);
    };
    listen(content, "beforetoggle", (event) => {
      // Before the first paint of the open content: the fallback's place, measured in the next frame.
      if ((event as ToggleEvent).newState === "open") schedule();
    });
    listen(content, "toggle", (event) => synced((event as ToggleEvent).newState ? (event as ToggleEvent).newState === "open" : popoverOpen(content)));

    // The model opens and closes the content.
    releases.push(effect(() => {
      const wanted = open.value;
      untrack(() => {
        if (wanted === popoverOpen(content)) return;
        if (wanted) show();
        else hide();
        // A DOM without the toggle event (a test DOM) settles the state here.
        if (popoverOpen(content) === wanted) queueMicrotask(() => { if (popoverOpen(content) === wanted) synced(wanted); });
      });
    }));

    const typeahead = createTypeahead();
    listen(content, "keydown", (event) => {
      const key = event as KeyboardEvent;
      if (key.defaultPrevented) return;
      if (key.key === "Escape" && popoverOpen(content)) {
        key.preventDefault();
        key.stopPropagation();
        closeToTrigger();
        return;
      }
      if (untrack(() => role.value) !== "menu") return;
      const items = menuItems(content);
      const current = items.indexOf((document.activeElement as HTMLElement | null) ?? content);
      const skip = (index: number): boolean => !focusable(items[index]!);
      if (key.key === "Tab") {
        if (key.shiftKey) key.preventDefault();
        closeToTrigger();
        return;
      }
      if ((key.key === "Enter" || key.key === " ") && current >= 0 && !/^(?:button|a)$/.test(items[current]!.localName)) {
        key.preventDefault();
        items[current]!.click();
        return;
      }
      let target = listKeyTarget(key.key, current, items.length, skip);
      if (target === undefined && typeaheadKey(key)) {
        target = typeaheadIndex(items.map((item) => item.textContent ?? ""), typeahead.push(key.key), current, skip);
      }
      if (target === undefined || target < 0) return;
      key.preventDefault();
      items[target]!.focus();
    });
    // Choosing an item closes the menu; a checkbox or radio item keeps it open.
    listen(content, "click", (event) => {
      if (untrack(() => role.value) !== "menu") return;
      const item = (event.target as Element | null)?.closest?.("[role=menuitem]");
      if (!item || !content.contains(item) || item.getAttribute("aria-disabled") === "true") return;
      queueMicrotask(closeToTrigger);
    });

    // Hint: hover and focus open it after a delay, without taking the focus.
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    const later = (work: () => void, delay: number): void => {
      if (hintTimer !== undefined) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => { hintTimer = undefined; work(); }, delay);
    };
    releases.push(() => { if (hintTimer !== undefined) clearTimeout(hintTimer); });
    const hinting = (): boolean => untrack(() => mode.value) === "hint";
    listen(content, "pointerenter", () => { if (hinting() && hintTimer !== undefined) clearTimeout(hintTimer); });
    listen(content, "pointerleave", () => { if (hinting()) later(hide, untrack(() => props.closeDelay ?? 150)); });
    listen(document, "keydown", (event) => {
      if (hinting() && (event as KeyboardEvent).key === "Escape" && popoverOpen(content)) hide();
    });

    const attachTrigger = (target: HTMLElement): void => {
      if (attached.has(target)) return;
      attached.add(target);
      if (supportsAnchorPositioning(view)) target.style.setProperty("anchor-name", anchorName);
      listen(target, "keydown", (event) => {
        const key = event as KeyboardEvent;
        if (key.defaultPrevented) return;
        if (key.key === "Escape" && popoverOpen(content)) {
          key.preventDefault();
          hide();
          return;
        }
        if (untrack(() => role.value) !== "menu") return;
        if (key.key === "ArrowDown" || key.key === "ArrowUp") {
          key.preventDefault();
          pending = key.key === "ArrowUp" ? "last" : "first";
          if (popoverOpen(content)) focusInside();
          else show();
        } else if (key.key === "Enter" || key.key === " ") pending = "first";
      });
      listen(target, "pointerenter", () => { if (hinting()) later(show, untrack(() => props.delay ?? 300)); });
      listen(target, "pointerleave", () => { if (hinting()) later(hide, untrack(() => props.closeDelay ?? 150)); });
      listen(target, "focusin", () => { if (hinting()) { if (hintTimer !== undefined) clearTimeout(hintTimer); show(); } });
      listen(target, "focusout", () => { if (hinting()) hide(); });
    };
    triggerElement();
    if (untrack(() => open.value) && !popoverOpen(content)) show();
    return () => {
      for (const release of releases.splice(0).reverse()) release();
      typeahead.clear();
      element = null;
    };
  };

  return { triggerId, contentId, mode, role, labelledBy, placement, trigger, mount, show, hide, toggle };
}
