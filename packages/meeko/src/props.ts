/**
 * Reactive props of a child component instance.
 *
 * A parent hydrates a compiled child with a read-only view of its props, backed by one signal per
 * prop name that the child reads. When the parent's binding reads new props it writes them into
 * those signals, so the child stays mounted and only the bindings that read a changed prop update.
 * Server renders, and any module that does not declare `__meekoReactiveProps`, keep receiving the
 * plain object.
 *
 * Every view shares one proxy handler and keeps its state in the proxy target, so an instance only
 * costs its target and the signals of the props it reads.
 *
 * The snippets that the parent passes travel in the channels, not as props. A conditional
 * `<snippet if:when>` makes one appear or disappear while the child stays mounted, so the view also
 * keeps one signal per snippet name that the child reads, through {@link passedSnippetsKey}.
 */
import { readChannels } from "./channels.js";
import { batch, signal, untrack } from "./reactivity.js";
import type { Signal } from "./reactivity.js";

/** Props view of a child instance and the writer that its parent's binding keeps. */
export interface PropsSource<Props extends object> {
  /** Read-only view that the child receives as its props. */
  readonly props: Props;
  /** Writes the props of the latest read; unchanged values notify nobody. */
  update(next: Props): void;
}

/** Views created by {@link reactiveProps} or {@link resolveProps}. */
const reactiveViews = new WeakSet<object>();

function readOnly(_target: object, key: string | symbol): never {
  throw new TypeError(`Meeko props are read-only: cannot change "${String(key)}"; emit an event or use a model so the parent changes it`);
}

/** Traps shared by both views: props never change from the child. Their targets are plain objects, so they keep the prototype of one. */
const readOnlyTraps = {
  set: readOnly,
  defineProperty: readOnly,
  deleteProperty: readOnly,
};

/** State of a view of {@link reactiveProps}, kept in its proxy target. */
interface PropsState {
  current: object;
  /** One signal per prop name read so far, also names the parent does not pass yet. */
  readonly values: Map<string, Signal<unknown>>;
  /** Version of the set of names, created the first time a reader enumerates or tests them. */
  shape: Signal<number> | undefined;
  /** One signal per snippet name read so far; its value only changes when the snippet appears or disappears. */
  snippets: Map<string, Signal<unknown>> | undefined;
  /** Version of the set of passed snippets, created the first time a reader enumerates or tests them. */
  snippetShape: Signal<number> | undefined;
}

/**
 * Key of the reader of the snippets that the parent passes now, on a view of {@link reactiveProps}
 * (also through the defaults view of {@link resolveProps}); `undefined` on plain props.
 */
export const passedSnippetsKey: unique symbol = Symbol("meeko.passedSnippets");

/** Tracked reads of the snippets that the parent passes to a mounted child. */
export interface PassedSnippets {
  /** The snippet `name` (or `undefined`), with the same identity while it stays passed. */
  get(name: string): unknown;
  /** Names of the snippets passed now. */
  names(): string[];
}

/** The snippet `name` in the channels of `props`, or `undefined`. */
function passedSnippet(props: object, name: string): unknown {
  const snippets = readChannels(props)?.snippets;
  return snippets && Object.hasOwn(snippets, name) ? snippets[name] : undefined;
}

/** Names of the snippets in the channels of `props`. */
function passedNames(props: object): string[] {
  const snippets = readChannels(props)?.snippets ?? {};
  return Object.keys(snippets).filter((name) => snippets[name] !== undefined);
}

function readSnippet(state: PropsState, name: string): unknown {
  const snippets = state.snippets ??= new Map();
  let value = snippets.get(name);
  if (!value) {
    value = signal(passedSnippet(state.current, name));
    snippets.set(name, value);
  }
  return value.value;
}

function snippetReader(state: PropsState): PassedSnippets {
  return {
    get: (name) => readSnippet(state, name),
    names: () => {
      void (state.snippetShape ??= signal(0)).value;
      return passedNames(state.current);
    },
  };
}

/**
 * Writes the snippets of the latest read. A snippet that is still passed keeps the value that the
 * child already has: its content is reactive by itself, and a new value would render it again.
 */
function updateSnippets(state: PropsState, previous: object, next: object): void {
  const shape = state.snippetShape;
  if (shape) {
    const before = passedNames(previous);
    const after = passedNames(next);
    if (before.length !== after.length || before.some((name) => !after.includes(name))) shape.value = untrack(() => shape.value) + 1;
  }
  for (const [name, value] of state.snippets ?? []) {
    const passed = passedSnippet(next, name);
    if ((untrack(() => value.value) === undefined) !== (passed === undefined)) value.value = passed;
  }
}

function readProp(state: PropsState, key: string): unknown {
  let value = state.values.get(key);
  if (!value) {
    value = signal(Reflect.get(state.current, key));
    state.values.set(key, value);
  }
  return value.value;
}

function trackShape(state: PropsState): void {
  void (state.shape ??= signal(0)).value;
}

const propsTraps: ProxyHandler<PropsState> = {
  ...readOnlyTraps,
  get: (state, key) => key === passedSnippetsKey ? snippetReader(state) : typeof key === "symbol" ? Reflect.get(state.current, key) : readProp(state, key),
  has: (state, key) => {
    trackShape(state);
    return Reflect.has(state.current, key);
  },
  ownKeys: (state) => {
    trackShape(state);
    return Reflect.ownKeys(state.current);
  },
  getOwnPropertyDescriptor: (state, key) => {
    trackShape(state);
    const descriptor = Reflect.getOwnPropertyDescriptor(state.current, key);
    if (!descriptor) return undefined;
    const value = typeof key === "symbol" ? Reflect.get(state.current, key) : readProp(state, key);
    return { value, writable: false, enumerable: descriptor.enumerable ?? true, configurable: true };
  },
};

function sameKeys(first: object, second: object): boolean {
  const before = Reflect.ownKeys(first);
  return before.length === Reflect.ownKeys(second).length && before.every((key) => Object.hasOwn(second, key));
}

/**
 * Creates the props of a child that its parent updates in place. Each prop name gets a signal the
 * first time it is read; the set of names (`in`, `Object.keys`, spreads) is tracked by a version
 * signal. Symbol keys, such as the channels of models and snippets, are read from the latest
 * object without tracking; the snippets are tracked through {@link passedSnippetsKey}.
 */
export function reactiveProps<Props extends object>(initial: Props): PropsSource<Props> {
  const state: PropsState = { current: initial, values: new Map(), shape: undefined, snippets: undefined, snippetShape: undefined };
  const view = new Proxy(state, propsTraps) as unknown as Props;
  reactiveViews.add(view);
  return {
    props: view,
    update(next) {
      batch(() => {
        const previous = state.current;
        state.current = next;
        const shape = state.shape;
        if (shape && !sameKeys(previous, next)) shape.value = untrack(() => shape.value) + 1;
        for (const [key, value] of state.values) value.value = Reflect.get(next, key);
        updateSnippets(state, previous, next);
      });
    },
  };
}

/** Whether `props` is a view of {@link reactiveProps} or {@link resolveProps}. */
export function isReactiveProps(props: unknown): boolean {
  return typeof props === "object" && props !== null && reactiveViews.has(props);
}

/** State of a view of {@link resolveProps}, kept in its proxy target. */
interface DefaultsState {
  readonly input: object;
  readonly defaults: object;
}

function defaulted(state: DefaultsState, key: string | symbol): boolean {
  return typeof key === "string" && Object.hasOwn(state.defaults, key);
}

function readDefaulted(state: DefaultsState, key: string | symbol): unknown {
  const value: unknown = Reflect.get(state.input, key);
  return value === undefined && defaulted(state, key) ? Reflect.get(state.defaults, key) : value;
}

const defaultsTraps: ProxyHandler<DefaultsState> = {
  ...readOnlyTraps,
  get: readDefaulted,
  has: (state, key) => defaulted(state, key) || Reflect.has(state.input, key),
  // The order of `{ ...defaults, ...input }`: defaults first, then the other passed props.
  ownKeys: (state) => [...new Set([...Object.keys(state.defaults), ...Reflect.ownKeys(state.input)])],
  getOwnPropertyDescriptor: (state, key) => {
    const descriptor = Reflect.getOwnPropertyDescriptor(state.input, key);
    if (!descriptor && !defaulted(state, key)) return undefined;
    return { value: readDefaulted(state, key), writable: false, enumerable: descriptor?.enumerable ?? true, configurable: true };
  },
};

/**
 * Applies the `defineProps` defaults of a compiled component: a prop that is absent or
 * `undefined` takes its default. Plain props are copied, as before 1.2; reactive props get a
 * read-only view that applies the defaults on every read, so a prop that becomes `undefined`
 * shows its default again. Internal to compiled components.
 */
export function resolveProps(input: object, defaults: object): object {
  if (!isReactiveProps(input)) {
    const resolved: Record<string, unknown> = { ...defaults, ...input };
    for (const key of Object.keys(defaults)) {
      if (resolved[key] === undefined) resolved[key] = (defaults as Record<string, unknown>)[key];
    }
    return resolved;
  }
  const view = new Proxy<DefaultsState>({ input, defaults }, defaultsTraps);
  reactiveViews.add(view);
  return view;
}

/** Reads every prop of a reactive view, so the observer that calls it follows any prop change. */
export function trackProps(props: object): void {
  for (const key of Reflect.ownKeys(props)) if (typeof key === "string") Reflect.get(props, key);
}
