import { createRoot, effect, signal } from "./reactivity.js";
import type { Signal } from "./reactivity.js";
import { attributeValue } from "./server.js";

/** Fragmento de DOM que pertenece a una instancia o a una región dinámica. */
export interface DomScope {
  root: Element;
  start?: Comment;
  end?: Comment;
}

function visit(scope: DomScope, callback: (node: Node) => boolean): Node | undefined {
  function descend(node: Node): Node | undefined {
    if (callback(node)) return node;
    for (const child of node.childNodes) {
      const found = descend(child);
      if (found) return found;
    }
    return undefined;
  }
  if (scope.start && scope.end) {
    for (let node = scope.start.nextSibling; node && node !== scope.end; node = node.nextSibling) {
      const found = descend(node);
      if (found) return found;
    }
    return undefined;
  }
  for (const child of scope.root.childNodes) {
    const found = descend(child);
    if (found) return found;
  }
  return undefined;
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
export function renderFor<T>(id: number, items: Iterable<T>, keyOf: (item: T, index: number) => unknown, render: (item: T, index: number) => string): string {
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
export function bindFor<T>(scope: DomScope, id: number, read: () => Iterable<T>, keyOf: (item: T, index: number) => unknown, render: (item: T, index: number) => string, hydrate: (item: Signal<T>, index: Signal<number>, inner: DomScope) => () => void): () => void {
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
