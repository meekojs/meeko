import { createContext, createRoot, finishWithCleanup, isDryRender, provide, signal, untrack } from "../../core/reactivity";
import { reactiveProps } from "./props";
import type { PropsSource } from "./props";
import type { Component, ComponentRelease, DomScope } from "./renderer";

/** One instance of a named layout in a browser tree: what it receives and the page that writes it. */
export interface LayoutSlot {
  readonly name: string;
  /** The props of the layout, `outlet` included, as the layout reads them. */
  readonly props: Record<string, unknown>;
  /** The component inside the layout. */
  readonly outlet: { value: Component<Record<string, unknown>> };
  /** Merged props the layout receives now, without `outlet`. */
  current(): Record<string, unknown>;
  /** Makes `owner` the page that writes the props, starting from `declared`. */
  reset(declared: Record<string, unknown>, owner: object): void;
  /** Writes props of `owner`; a page that is no longer the owner writes nothing. */
  write(owner: object, patch: Record<string, unknown>): void;
  /** Captures the props and owner; the returned function puts them back. */
  save(): () => void;
}

/** Creates the props of a named layout in the browser, reactive also for its outlet. */
export function createLayoutSlot(name: string, declared: Record<string, unknown>, outlet: Component<Record<string, unknown>>, owner: object): LayoutSlot {
  let base = { ...declared };
  let overrides: Record<string, unknown> = {};
  let owning = owner;
  let child = outlet;
  const version = signal(0);
  const merged = (): Record<string, unknown> => ({ ...base, ...overrides });
  const source: PropsSource<Record<string, unknown>> = reactiveProps({ ...merged(), outlet: child });
  const update = (): void => {
    source.update({ ...merged(), outlet: child });
    version.value = untrack(() => version.value) + 1;
  };
  return {
    name,
    props: source.props,
    outlet: {
      get value() { return child; },
      set value(next) { child = next; update(); },
    },
    current: () => { void version.value; return merged(); },
    reset(next, nextOwner) {
      base = { ...next };
      overrides = {};
      owning = nextOwner;
      update();
    },
    write(writer, patch) {
      if (writer !== owning) return;
      overrides = { ...overrides, ...patch };
      update();
    },
    save() {
      const saved = { base, overrides, owning };
      return () => {
        ({ base, overrides, owning } = saved);
        update();
      };
    },
  };
}

/**
 * The `useLayout()` of one page tree. While the tree renders and hydrates its writes wait in a
 * buffer: the layout around it was rendered first, and changing it then would not match its HTML.
 */
export interface LayoutWriter {
  readonly name: string | undefined;
  /** Merged props, reactive in the browser. */
  read(): Record<string, unknown>;
  write(patch: Record<string, unknown>): void;
}

/** The writer of a browser page tree; `activate` applies what the tree wrote while it rendered. */
export interface BrowserLayoutWriter extends LayoutWriter {
  /** The page's object that owns the slot it writes. */
  readonly owner: object;
  /** The slot it writes, if the page has a named layout. */
  readonly slot: LayoutSlot | undefined;
  /** Applies what the tree wrote while it rendered and hydrated; later writes apply at once. */
  activate(): void;
}

/** A writer for a browser page tree inside `slot` (or without a named layout). */
export function browserLayoutWriter(slot: LayoutSlot | undefined, owner: object = {}): BrowserLayoutWriter {
  let buffer: Record<string, unknown> | undefined = {};
  return {
    name: slot?.name,
    owner,
    slot,
    read: () => slot ? { ...slot.current(), ...buffer } : {},
    write(patch) {
      if (!slot || isDryRender()) return;
      if (buffer) buffer = { ...buffer, ...patch };
      else slot.write(owner, patch);
    },
    activate() {
      const pending = buffer;
      buffer = undefined;
      if (slot && pending && Object.keys(pending).length) slot.write(owner, pending);
    },
  };
}

/** A writer for a server render: it records what the page writes, for the next pass. */
export interface ServerLayoutWriter extends LayoutWriter {
  /** What the page wrote during the pass, over the props the pass rendered with. */
  readonly written: Record<string, unknown>;
}

/** The server writer of a page rendered with `rendered` as the layout's props. */
export function serverLayoutWriter(name: string | undefined, rendered: Record<string, unknown>): ServerLayoutWriter {
  const written: Record<string, unknown> = {};
  return {
    name,
    written,
    read: () => ({ ...rendered, ...written }),
    write(patch) { if (name !== undefined && !isDryRender()) Object.assign(written, patch); },
  };
}

export const layoutKey = createContext<LayoutWriter>("meeko.layout");

/** Wraps a page tree so that `useLayout()` in it reaches `writer`. */
export function withLayoutWriter<M extends { renderWithState?: unknown; renderToString?: unknown; hydrateScope?: unknown }>(module: M, writer: LayoutWriter): M {
  const scoped = <T>(work: () => T): T => createRoot((dispose) => {
    provide(layoutKey, writer);
    return finishWithCleanup(work, dispose);
  });
  const source = module as unknown as {
    renderWithState?: (props: Record<string, unknown>) => { html: string; state: Record<string, unknown> };
    renderToString?: (props: Record<string, unknown>, state?: Record<string, unknown>) => string;
    hydrateScope?: (scope: DomScope, props: Record<string, unknown>, state?: Record<string, unknown>) => ComponentRelease;
  };
  const wrapped: Record<string, unknown> = { ...module };
  if (source.renderWithState) wrapped.renderWithState = (props: Record<string, unknown>) => scoped(() => source.renderWithState!(props));
  if (source.renderToString) wrapped.renderToString = (props: Record<string, unknown>, state?: Record<string, unknown>) => scoped(() => source.renderToString!(props, state));
  if (source.hydrateScope) {
    wrapped.hydrateScope = (scope: DomScope, props: Record<string, unknown>, state?: Record<string, unknown>): ComponentRelease => createRoot((dispose) => {
      provide(layoutKey, writer);
      const release = source.hydrateScope!(scope, props, state);
      const result: ComponentRelease = () => finishWithCleanup(release, dispose);
      if (release.snapshot) result.snapshot = release.snapshot;
      return "exposed" in release ? Object.assign(result, { exposed: release.exposed }) : result;
    });
  }
  return wrapped as M;
}

/**
 * Layout props without their `undefined` keys: the layout takes its default for them, in the server
 * render, in the payload and in the browser alike (as `bind="obj"` does with component props).
 */
export function definedLayoutProps(props: Record<string, unknown>): Record<string, unknown> {
  const defined: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) if (value !== undefined) defined[key] = value;
  return defined;
}

/** `layoutProps` of route options: an object, or a function of the page context, without `undefined` keys. */
export function resolveLayoutProps(input: unknown, context: unknown): Record<string, unknown> {
  if (input === undefined) return {};
  const value = typeof input === "function" ? (input as (context: unknown) => unknown)(context) : input;
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("layoutProps must be an object of layout props, or a function that returns one");
  return definedLayoutProps(value as Record<string, unknown>);
}
