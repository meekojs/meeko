import { batch, createRoot, effect, finishWithCleanup, signal } from "./reactivity.js";
import { observeCallback } from "./error-observer.js";
import { componentErrorReporter } from "./component-errors.js";
import type { EffectSource, Signal } from "./reactivity.js";
import { attributeValue, serializeJson } from "./server.js";

/** Fragmento de DOM que pertenece a una instancia o a una región dinámica. */
export interface DomScope {
  root: Element;
  start?: Comment;
  end?: Comment;
}

/** Contrato de un módulo de componente compilado para composición sin wrapper. */
export interface ComponentModule<Props extends object> {
  readonly renderToString: (props: Props, state?: Record<string, unknown>) => string;
  readonly renderWithState?: (props: Props) => { html: string; state: Record<string, unknown> };
  readonly hydrateScope: (scope: DomScope, props: Props, state?: Record<string, unknown>) => ComponentRelease;
}

/** Componente compilado que puede transferir su estado durante SSR. */
export type Component<Props extends object> = ComponentModule<Props> & {
  readonly renderWithState: (props: Props) => { html: string; state: Record<string, unknown> };
};

/** Función de limpieza que puede exponer el estado editable de su instancia. */
export interface ComponentRelease {
  (): void;
  snapshot?: () => Record<string, unknown>;
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
export function renderComponent<Props extends object>(id: number, component: Component<Props>, props: Props, transferState: boolean): string;
export function renderComponent<Props extends object>(id: number, component: ComponentModule<Props>, props: Props, transferState?: false): string;
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
export function bindComponent<Props extends object>(scope: DomScope, id: number, input: ComponentModule<Props> | (() => ComponentModule<Props>), read: () => Props, location: string): () => void {
  let inner: DomScope;
  let state: Record<string, unknown> | undefined;
  try {
    ({ inner, state } = componentRegion(scope, id));
  } catch (error) {
    throw new Error(`Hydration mismatch in ${location}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const resolveComponent = (): ComponentModule<Props> => typeof input === "function" ? input() : input;
  let component = resolveComponent();
  let props = read();
  let release = component.hydrateScope(inner, props, state);
  let stop = () => {};
  stop = effect(() => {
    const nextComponent = resolveComponent();
    const next = read();
    if (nextComponent === component && sameProps(props, next)) return;
    const previousState = release.snapshot?.();
    const state = nextComponent === component ? previousState : undefined;
    const html = nextComponent.renderToString(next, state);
    const previous = cloneRegion(inner);
    try {
      release();
      clearRegion(inner);
      insertHtml(inner.end!, html);
      const nextRelease = nextComponent.hydrateScope(inner, next, state);
      release = nextRelease;
      component = nextComponent;
      props = next;
    } catch (error) {
      try {
        restoreRegion(inner, previous);
        release = component.hydrateScope(inner, props, previousState);
      } catch (rollbackError) {
        release = () => {};
        stop();
        throw new AggregateError([error, rollbackError], `Meeko component update and recovery failed in ${location}`);
      }
      throw error;
    }
  });
  return () => { stop(); release(); };
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
      if (target.getAttribute(name) === next) return;
    }
    if (next === null) target.removeAttribute(name);
    else target.setAttribute(name, next);
  }, source);
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
  stop = effect(() => {
    const next = Boolean(read());
    if (next === active) return;
    if (next) {
      const html = render();
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
  stop = effect(() => {
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
      html: `<!--meeko:item:${id}:${nextKeys[index]}-->${render(item, index)}<!--/meeko:item:${id}:${nextKeys[index]}-->`,
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
  });
  return () => {
    stop();
    try { releaseAll([...entries.values()].map((entry) => entry.release)); }
    finally { entries.clear(); }
  };
}
