import { createContext, createRoot, findContext, finishWithCleanup, isDryRender, provide, signal, untrack } from "../reactivity.js";
import { reactiveProps } from "../props.js";
import type { PropsSource } from "../props.js";
import type { Component, ComponentRelease, DomScope } from "../dom.js";
import type { GeneratedLayouts, GeneratedPageLayouts } from "../framework.js";

/**
 * Nombre de un layout con nombre de la aplicación (`app/layouts/<nombre>.meeko`, los de los layers y
 * los de `meeko.addLayout`): la unión que declara `.meeko/types/routes.d.ts` (`meeko check`,
 * `meeko dev`), o `string` sin esas declaraciones.
 *
 * @since 1.5.0
 * @example
 * ```ts
 * import type { LayoutName } from "@meekojs/meeko/framework";
 *
 * const layout: LayoutName = "dashboard";
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#layouts-con-nombre
 */
export type LayoutName = keyof GeneratedLayouts extends never ? string : keyof GeneratedLayouts & string;

type OwnProps<P> = P extends object ? { [K in keyof P as K extends "outlet" ? never : K]: P[K] } : Record<string, unknown>;

/**
 * Props que una página puede pasar al layout `L`: las `Props` que declara el layout, sin `outlet`.
 * Con `false` (página sin layout con nombre) no hay ninguna; sin las declaraciones generadas, es
 * `Record<string, unknown>`.
 *
 * @typeParam L Nombre del layout, o `false`.
 * @since 1.5.0
 * @example
 * ```ts
 * import type { LayoutProps } from "@meekojs/meeko/framework";
 *
 * // Con app/layouts/dashboard.meeko declarando { title?: string; showAlert?: boolean }:
 * const props: LayoutProps<"dashboard"> = { title: "Conexiones", showAlert: true };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#props-del-layout-desde-la-página
 */
export type LayoutProps<L extends string | false = LayoutName> = [L] extends [false] ? Record<string, never>
  : L extends keyof GeneratedLayouts ? OwnProps<GeneratedLayouts[L]> : Record<string, unknown>;

/**
 * Layout con nombre de la página cuyo ID de ruta es `Id`, tal como lo resuelven su `definePage` y
 * los `+group.ts` de sus carpetas: un nombre, `false` sin layout con nombre o, sin las declaraciones
 * generadas, {@link LayoutName}. Tipa `useLayout()` en el `<script>` de cada página.
 *
 * @typeParam Id ID de la ruta, como `"/dashboard"`.
 * @since 1.5.0
 * @example
 * ```ts
 * import type { PageLayout } from "@meekojs/meeko/framework";
 *
 * type DashboardLayout = PageLayout<"/dashboard">; // "dashboard"
 * ```
 */
export type PageLayout<Id extends string> = Id extends keyof GeneratedPageLayouts ? GeneratedPageLayouts[Id] : LayoutName;

/**
 * Lo que devuelve {@link useLayout}: las props del layout con nombre de la página, para leerlas y
 * cambiarlas desde el `<script>` de la página.
 *
 * @typeParam P Props del layout, sin `outlet`.
 * @since 1.5.0
 * @example
 * ```html
 * <script lang="ts">
 * const layout = useLayout();
 * const title = signal("Conexiones");
 * effect(() => layout.set({ title: title.value }));
 * </script>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#props-del-layout-desde-la-página
 */
export interface LayoutHandle<P extends object = Record<string, unknown>> {
  /** Nombre del layout con nombre de la página, o `undefined` si no tiene (`layout: false`). */
  readonly name: string | undefined;
  /**
   * Las props que recibe ahora el layout (sin `outlet`): las de `layoutProps` y los `+group.ts` con
   * lo que haya escrito la página encima. La lectura es reactiva.
   */
  readonly props: Readonly<Partial<P>>;
  /**
   * Cambia props del layout; las que no nombra se conservan. El layout no se vuelve a montar: sólo
   * cambia lo que lee esas props. Al navegar a otra página, el layout recibe las de la página nueva.
   * Sin layout con nombre, no hace nada.
   */
  set<const Q extends Partial<P>>(patch: Q & { readonly [K in Exclude<keyof Q, keyof P>]: never }): void;
}

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

const layoutKey = createContext<LayoutWriter>("meeko.layout");

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
 * Da acceso a las props del layout con nombre de la página desde su `<script>` (y desde sus
 * componentes y sus `+layout.meeko`). Se autoimporta. En una página, su tipo sigue al layout que
 * eligen su `definePage` o sus `+group.ts`; en otro componente, `useLayout<"dashboard">()`.
 *
 * Las escrituras del setup de la página ya cuentan en el HTML del servidor: si la página escribe
 * durante el render, el servidor vuelve a renderizar la página una vez con esos valores, de modo que
 * la hidratación coincide. En el navegador, lo que se escribe mientras la página se renderiza se
 * aplica al terminar de montarla; después, cada `set` se aplica al momento. Al navegar a otra página,
 * el layout vuelve a las props de la página nueva (sus `layoutProps`, las de sus `+group.ts` y los
 * valores por defecto del layout): nada queda de la anterior.
 *
 * @typeParam L Layout de la página; en una página lo pone Meeko.
 * @returns El acceso a las props del layout; sin layout con nombre, uno que no hace nada.
 * @throws {Error} Fuera de una página que renderiza Meeko (por ejemplo, en una prueba unitaria).
 * @since 1.5.0
 * @example
 * ```html
 * <!-- app/pages/connections.meeko, con layout: "dashboard" -->
 * <script lang="ts">
 * const layout = useLayout();
 * const failing = signal(false);
 * effect(() => layout.set({ showAlert: failing.value }));
 * </script>
 * <template><button on:click="() => failing.value = !failing.value">Probar</button></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#props-del-layout-desde-la-página
 */
export function useLayout<L extends LayoutName | false = LayoutName>(): LayoutHandle<LayoutProps<L>> {
  const writer = findContext(layoutKey);
  if (!writer) {
    throw new Error("useLayout() necesita una página que renderiza Meeko: sólo funciona en las páginas, en sus componentes y en sus +layout.meeko. En una prueba unitaria, pasa los valores al componente como props.");
  }
  return Object.freeze({
    name: writer.name,
    get props() { return writer.read() as Readonly<Partial<LayoutProps<L>>>; },
    set(patch: object) {
      if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new TypeError("useLayout().set() necesita un objeto con las props del layout");
      writer.write({ ...patch } as Record<string, unknown>);
    },
  });
}

/**
 * Valor de `layoutProps`: las props del layout `L` o, en las opciones de ruta, una función que las
 * calcula con el contexto de la página (`data` incluido), como `head`. Viajan en el payload, así que
 * deben poder serializarse en JSON.
 *
 * @typeParam L Layout de la página.
 * @typeParam C Contexto de la función.
 * @since 1.5.0
 * @example
 * ```ts
 * import type { LayoutPropsInput } from "@meekojs/meeko/framework";
 *
 * const input: LayoutPropsInput<"dashboard", { data: { name: string } }> = ({ data }) => ({ title: data.name });
 * ```
 */
export type LayoutPropsInput<L extends string | false, C> = Partial<LayoutProps<L>> | ((context: C) => Partial<LayoutProps<L>>);

/**
 * Opciones de layout de las opciones de ruta (`definePage`): `layout` elige el layout con nombre y
 * `layoutProps` le pasa props, tipadas contra ese layout. Sin `layout`, la página hereda el de sus
 * `+group.ts` o `default`; entonces `meeko check` comprueba `layoutProps` contra el heredado.
 *
 * @typeParam C Contexto de la función de `layoutProps`.
 * @since 1.5.0
 * @example
 * ```ts
 * import type { PageLayoutOptions } from "@meekojs/meeko/framework";
 *
 * const options: PageLayoutOptions<unknown> = { layout: "dashboard", layoutProps: { title: "Panel" } };
 * ```
 */
export type PageLayoutOptions<C> =
  | {
    /** Sin `layout`, el de los `+group.ts` de la página o `default`. */
    readonly layout?: undefined;
    /** Props para el layout heredado; `meeko check` las compara con las suyas. */
    readonly layoutProps?: LayoutPropsInput<LayoutName, C>;
  }
  | {
    /** Sin layout con nombre: quedan `app/app.meeko` y los `+layout.meeko`. */
    readonly layout: false;
    /** Sin layout con nombre no hay props que pasar. */
    readonly layoutProps?: never;
  }
  | { [L in LayoutName]: {
    /** Layout con nombre de la página. */
    readonly layout: L;
    /** Props del layout `L`: un objeto o una función del contexto de la página. */
    readonly layoutProps?: LayoutPropsInput<L, C>;
  } }[LayoutName];

/**
 * Opciones de un `+group.ts`, que heredan las páginas de su carpeta y de sus subcarpetas. Meeko las
 * lee sin ejecutar el archivo: `layout` es un literal y `layoutProps` un objeto literal.
 *
 * @typeParam L Layout del grupo.
 * @since 1.5.0
 * @example
 * ```ts
 * import type { GroupDefinition } from "@meekojs/meeko/framework";
 *
 * const group: GroupDefinition<"dashboard"> = { layout: "dashboard", layoutProps: { showAlert: false } };
 * ```
 */
export interface GroupDefinition<L extends LayoutName | false = LayoutName> {
  /** Layout con nombre de las páginas del grupo, o `false` para quitarlo. Una página puede elegir otro. */
  readonly layout?: L;
  /**
   * Props del layout para las páginas del grupo. Se combinan por clave con las de los grupos
   * exteriores y con las de la página, que gana. Un grupo o una página que elige otro layout empieza
   * sin las props heredadas.
   */
  readonly layoutProps?: Partial<LayoutProps<L>>;
}

/**
 * Declara las opciones de una carpeta de `app/pages` en su `+group.ts`: el layout con nombre y sus
 * props, que heredan todas las páginas de la carpeta y de sus subcarpetas. Se autoimporta. Meeko lee
 * el archivo sin ejecutarlo, así que sus valores deben ser literales.
 *
 * @typeParam L Layout del grupo, inferido de `layout`.
 * @param definition Opciones del grupo.
 * @returns La misma definición.
 * @since 1.5.0
 * @example
 * ```ts
 * // app/pages/(dashboard)/+group.ts
 * export default defineGroup({ layout: "dashboard", layoutProps: { showAlert: false } });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#opciones-por-carpeta-groupts
 */
export function defineGroup<const L extends LayoutName | false = LayoutName>(definition: GroupDefinition<L>): GroupDefinition<L> {
  return definition;
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
