import { createRoot, effect, signal } from "./reactivity.js";
import type { Signal } from "./reactivity.js";
import { attributeValue, serializeJson } from "./server.js";

/** Fragmento de DOM que pertenece a una instancia o a una región dinámica. */
export interface DomScope {
  root: Element;
  start?: Comment;
  end?: Comment;
}

/** Contrato de un módulo de componente compilado para composición sin wrapper. */
export interface ComponentModule<Props extends object> {
  renderToString(props: Props, state?: Record<string, unknown>): string;
  renderWithState?(props: Props): { html: string; state: Record<string, unknown> };
  hydrateScope(scope: DomScope, props: Props, state?: Record<string, unknown>): ComponentRelease;
}

/** Función de limpieza que puede exponer el estado editable de su instancia. */
export interface ComponentRelease {
  (): void;
  snapshot?: () => Record<string, unknown>;
}

/** Añade una lectura de estado a la limpieza de un componente compilado. */
export function withStateSnapshot(release: () => void, snapshot: () => Record<string, unknown>): ComponentRelease {
  return Object.assign(release, { snapshot });
}

const componentStart = /^meeko:component:\d+(?::.*)?$/;

function componentEnd(start: Node): Node {
  let depth = 0;
  for (let node: Node | null = start; node; node = node.nextSibling) {
    if (node.nodeType !== 8) continue;
    const data = (node as Comment).data;
    if (componentStart.test(data)) depth++;
    else if (/^\/meeko:component:\d+$/.test(data) && --depth === 0) return node;
  }
  throw new Error(`Missing end marker for ${(start as Comment).data}`);
}

function visit(scope: DomScope, callback: (node: Node) => boolean): Node | undefined {
  function siblings(first: Node | null, stop: Node | null = null): Node | undefined {
    for (let node = first; node && node !== stop;) {
      if (callback(node)) return node;
      if (node.nodeType === 8 && componentStart.test((node as Comment).data)) {
        const end = componentEnd(node);
        if (callback(end)) return end;
        node = end.nextSibling;
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

function insertHtml(end: Comment, html: string): void {
  const parent = end.parentNode;
  if (!parent) throw new Error("Detached Meeko region");
  const range = end.ownerDocument.createRange();
  range.selectNodeContents(parent);
  parent.insertBefore(range.createContextualFragment(html), end);
}

function sameProps<Props extends object>(first: Props, second: Props): boolean {
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  return firstKeys.length === secondKeys.length && firstKeys.every((key) => Object.hasOwn(second, key) && Object.is(first[key as keyof Props], second[key as keyof Props]));
}

/** Renderiza un hijo entre comentarios de ámbito sin añadir un elemento visual. */
export function renderComponent<Props extends object>(id: number, component: ComponentModule<Props>, props: Props, transferState = false): string {
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

/** Hidrata un hijo dentro de su rango y actualiza props reactivas con limpieza previa. */
export function bindComponent<Props extends object>(scope: DomScope, id: number, component: ComponentModule<Props>, read: () => Props, location: string): () => void {
  let inner: DomScope;
  let state: Record<string, unknown> | undefined;
  try {
    ({ inner, state } = componentRegion(scope, id));
  } catch (error) {
    throw new Error(`Hydration mismatch in ${location}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  let props = read();
  let release = component.hydrateScope(inner, props, state);
  const stop = effect(() => {
    const next = read();
    if (sameProps(props, next)) return;
    const state = release.snapshot?.();
    const html = component.renderToString(next, state);
    release();
    clearRegion(inner);
    insertHtml(inner.end!, html);
    release = component.hydrateScope(inner, next, state);
    props = next;
  });
  return () => { stop(); release(); };
}

/** Conecta un texto reactivo al marcador SSR y comprueba su valor inicial. */
export function bindText(scope: DomScope, id: number, read: () => unknown, location: string): () => void {
  const marker = findComment(scope, `meeko:text:${id}`);
  const text = marker.nextSibling;
  if (!text || text.nodeType !== 3) throw new Error(`Missing text node in ${location}`);
  if (text.textContent !== String(read())) throw new Error(`Hydration mismatch in ${location}`);
  return effect(() => { text.textContent = String(read()); });
}

/** Conecta un atributo dinámico al elemento SSR y comprueba su valor inicial. */
export function bindAttribute(scope: DomScope, id: number, name: string, read: () => unknown, location: string): () => void {
  const target = findElement(scope, `data-meeko-a-${id}`);
  if (target.getAttribute(name) !== attributeValue(name, read())) throw new Error(`Hydration mismatch in ${location}`);
  return effect(() => {
    const next = attributeValue(name, read());
    if (next === null) target.removeAttribute(name);
    else target.setAttribute(name, next);
  });
}

/** Conecta un evento al elemento SSR y entrega su función de limpieza. */
export function bindEvent(scope: DomScope, id: number, name: string, handler: (event: Event) => void): () => void {
  const target = findElement(scope, `data-meeko-e-${id}`);
  target.addEventListener(name, handler);
  return () => target.removeEventListener(name, handler);
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
  const stop = effect(() => {
    const next = Boolean(read());
    if (next === active) return;
    release?.();
    release = undefined;
    clearRegion(inner);
    if (next) {
      insertHtml(inner.end!, render());
      release = hydrate(inner);
    }
    active = next;
  });
  return () => { stop(); release?.(); };
}

/** Convierte una clave de lista en un token seguro para comentarios HTML. */
export function keyToken(key: unknown): string {
  if (typeof key === "number" && Number.isFinite(key)) return `n${encodeURIComponent(String(key)).replaceAll("-", "%2D")}`;
  if (typeof key === "string") return `s${encodeURIComponent(key).replaceAll("-", "%2D")}`;
  throw new TypeError("Meeko list keys must be strings or finite numbers");
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
  index: Signal<number>;
  release: () => void;
}

function moveRange(start: Comment, end: Comment, before: Node): void {
  const parent = before.parentNode;
  if (!parent) throw new Error("Detached Meeko list");
  const document = before.ownerDocument;
  if (!document) throw new Error("Missing document for Meeko list");
  const fragment = document.createDocumentFragment();
  for (let node: Node | null = start; node;) {
    const next: Node | null = node.nextSibling;
    fragment.appendChild(node);
    if (node === end) break;
    node = next;
  }
  parent.insertBefore(fragment, before);
}

/** Hidrata una lista y reordena regiones por clave sin reemplazar nodos conservados. */
export function bindFor<T>(scope: DomScope, id: number, read: () => Iterable<T>, keyOf: (item: T, index: number) => string | number, render: (item: T, index: number) => string, hydrate: (item: Signal<T>, index: Signal<number>, inner: DomScope) => () => void): () => void {
  const outer = region(scope, "for", id);
  const entries = new Map<string, ListEntry<T>>();
  const initial = [...read()];
  let cursor = outer.start!.nextSibling;
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
    const position = signal(index);
    const release = createRoot((dispose) => {
      const cleanup = hydrate(value, position, { root: scope.root, start, end: end as Comment });
      return () => { cleanup(); dispose(); };
    });
    entries.set(key, { key, start, end: end as Comment, value, index: position, release });
    cursor = end.nextSibling;
  }
  if (cursor !== outer.end) throw new Error(`Hydration mismatch in list ${id}: extra nodes`);
  const stop = effect(() => {
    const items = [...read()];
    const nextKeys = items.map((item, index) => keyToken(keyOf(item, index)));
    if (new Set(nextKeys).size !== nextKeys.length) throw new Error(`Duplicate Meeko list key in region ${id}`);
    for (const [key, entry] of entries) {
      if (nextKeys.includes(key)) continue;
      entry.release();
      let node: Node | null = entry.start;
      while (node) {
        const next: Node | null = node.nextSibling;
        node.parentNode?.removeChild(node);
        if (node === entry.end) break;
        node = next;
      }
      entries.delete(key);
    }
    let before: Node = outer.end!;
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index]!;
      const key = nextKeys[index]!;
      let entry = entries.get(key);
      if (!entry) {
        const html = `<!--meeko:item:${id}:${key}-->${render(item, index)}<!--/meeko:item:${id}:${key}-->`;
        insertHtml(before as Comment, html);
        const end = before.previousSibling as Comment;
        let start: Node | null = end.previousSibling;
        while (start && (start.nodeType !== 8 || (start as Comment).data !== `meeko:item:${id}:${key}`)) start = start.previousSibling;
        if (!start) throw new Error(`Missing new list marker for ${key}`);
        const value = signal(item);
        const position = signal(index);
        const release = createRoot((dispose) => {
          const cleanup = hydrate(value, position, { root: scope.root, start: start as Comment, end });
          return () => { cleanup(); dispose(); };
        });
        entry = { key, start: start as Comment, end, value, index: position, release };
        entries.set(key, entry);
      } else {
        entry.value.value = item;
        entry.index.value = index;
      }
      if (entry.end.nextSibling !== before) moveRange(entry.start, entry.end, before);
      before = entry.start;
    }
  });
  return () => { stop(); for (const entry of entries.values()) entry.release(); entries.clear(); };
}
