/**
 * Runtime and types behind `defineSnippets<T>()`, `<snippet name params>` and
 * `<render snippet args>`.
 *
 * A snippet is template content that a parent writes between the tags of a child and the child
 * places with `<render>`. Its content belongs to the parent: it reads the parent's scope, and its
 * bindings live in the parent's reactive root although its nodes sit in the child's DOM.
 */
import { readChannels } from "./channels.js";
import type { ChannelsOf } from "./channels.js";
import type { DomScope } from "./dom.js";
import { passedSnippetsKey } from "./props.js";
import type { PassedSnippets } from "./props.js";
import { currentEffectOwner } from "./reactivity.js";
import type { ReadonlySignal } from "./reactivity.js";

declare const snippetArguments: unique symbol;

/**
 * Contenido de plantilla que un padre pasa a un hijo y que el hijo coloca con `<render>`. `Args`
 * son los parámetros que el hijo le entrega. Es el tipo de cada campo que devuelve
 * `defineSnippets<T>()`; sólo sirve para tipar, su contenido en tiempo de ejecución es interno.
 * Desde 1.4, una clave de `T` también puede ser un `Snippet<Args>`, que cuenta como `Args`: así
 * `defineSnippets<Omit<AppCardSnippets, "footer">>()` reutiliza los snippets de otro componente.
 *
 * @typeParam Args Tupla de parámetros que recibe el snippet.
 * @since 1.1.0
 * @example
 * ```html
 * <script lang="ts">
 * const props = defineProps<{ names: string[] }>();
 * // snippets.item es Snippet<[name: string]>.
 * const snippets = defineSnippets<{ item: [name: string] }>();
 * </script>
 * <template><ul><li each:of="props.names" each:as="name"><render snippet="snippets.item" args="name" /></li></ul></template>
 * ```
 */
export interface Snippet<Args extends readonly unknown[] = []> {
  /** Sólo de tipo: los parámetros del snippet. */
  readonly [snippetArguments]?: (...args: Args) => void;
}

const snippetData = Symbol("meeko.snippet");

/** What a compiled snippet carries at runtime. */
export interface SnippetData {
  readonly render: (...args: readonly unknown[]) => string;
  readonly hydrate: ((args: ReadonlySignal<readonly unknown[]>, scope: DomScope) => () => void) | undefined;
  /** Reactive root of the parent where the snippet was written. */
  readonly owner: object | undefined;
}

/**
 * Crea un snippet en la raíz reactiva actual del padre. Interno a los componentes compilados: sólo
 * la etiqueta del componente tipa `Args`, así que unos `params` de más fallan en la función; un
 * nombre que el hijo no declara recibe `any[]` además de su propio error.
 */
export function snippet<Args extends readonly unknown[] = any[]>(render: NoInfer<(...args: Args) => string>, hydrate?: NoInfer<(args: ReadonlySignal<Args>, scope: DomScope) => () => void>): Snippet<Args> {
  const data: SnippetData = {
    render: render as unknown as SnippetData["render"],
    hydrate: hydrate as SnippetData["hydrate"],
    owner: currentEffectOwner(),
  };
  return { [snippetData]: data } as unknown as Snippet<Args>;
}

/** Runtime data of a snippet, or `undefined` for anything else. */
export function snippetOf(value: unknown): SnippetData | undefined {
  return typeof value === "object" && value !== null ? (value as { [snippetData]?: SnippetData })[snippetData] : undefined;
}

/**
 * What each key of a `defineSnippets` type may hold: the tuple of its parameters or, since 1.4, a
 * `Snippet<Args>`, as in the `ComponentSnippets` (or `AppCardSnippets`) of another component.
 */
type SnippetEntry = readonly unknown[] | Snippet<never>;

/** Constraint of a `defineSnippets` type: every snippet maps to its parameters, as a tuple or a `Snippet`. */
export type SnippetTypes<T extends { [K in keyof T]: SnippetEntry }> = T;

/**
 * Parameter tuple of a snippet type: the tuple itself or the `Args` of a `Snippet<Args>`.
 * Distributive, so the `undefined` of an optional snippet drops out.
 */
type SnippetParameters<Entry> = Entry extends readonly unknown[] ? Entry : Entry extends Snippet<infer Args extends readonly unknown[]> ? Args : never;

/** Snippets of a `defineSnippets` type, with its optional names; a `Snippet` entry stays as it is. */
export type SnippetMap<T> = { [K in keyof T]: Snippet<SnippetParameters<T[K]>> };

/** Parameters of the snippet `name` of a compiled component, or `any[]` if it has none by that name. */
export type SnippetArgs<Module, Name extends string> = ChannelsOf<Module> extends { readonly snippets: infer Snippets }
  ? Snippets extends object
    ? Name extends keyof Snippets ? (NonNullable<Snippets[Name]> extends Snippet<infer Args> ? Args : any[]) : any[]
    : any[]
  : any[];

function readOnlySnippets(): never {
  throw new TypeError("Meeko snippets are read-only: the parent passes them with <snippet>");
}

/** Traps of the snippets of a mounted child, whose parent may start or stop passing one (`<snippet if:when>`). */
const passedSnippetsTraps: ProxyHandler<{ readonly reader: PassedSnippets }> = {
  get: ({ reader }, key) => {
    if (typeof key === "symbol") return undefined;
    const value = reader.get(key);
    return snippetOf(value) ? value : undefined;
  },
  has: ({ reader }, key) => typeof key === "string" && reader.names().includes(key) && snippetOf(reader.get(key)) !== undefined,
  ownKeys: ({ reader }) => reader.names().filter((name) => snippetOf(reader.get(name))),
  getOwnPropertyDescriptor: ({ reader }, key) => {
    if (typeof key === "symbol") return undefined;
    const value = reader.get(key);
    return snippetOf(value) ? { value, writable: false, enumerable: true, configurable: true } : undefined;
  },
  set: readOnlySnippets,
  defineProperty: readOnlySnippets,
  deleteProperty: readOnlySnippets,
};

/**
 * The snippets that the parent passed to this instance. On a child whose props the parent updates
 * in place, each read is tracked: a binding that reads `snippets.x` follows a `<snippet if:when>`
 * of the parent, and a snippet that stays passed keeps its identity.
 */
export function useSnippets<T>(props: object): SnippetMap<T> {
  const reader = (props as { readonly [passedSnippetsKey]?: PassedSnippets })[passedSnippetsKey];
  if (reader) return new Proxy({ reader }, passedSnippetsTraps) as unknown as SnippetMap<T>;
  const passed = readChannels(props)?.snippets ?? {};
  const snippets: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(passed)) if (snippetOf(value)) snippets[name] = value;
  return Object.freeze(snippets) as SnippetMap<T>;
}
