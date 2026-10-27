/**
 * Models and snippets travel from a parent to a child next to the props, under `channelsKey`, a
 * symbol. They are not props: `Object.keys`, `ComponentProps` and prop spreads in user code never
 * see them. A compiled module declares their types in `__meekoChannels`, a declaration without
 * runtime value that the parent's type checks read from the imported module.
 */
import type { ExposedOf } from "./expose.js";

/** Key of the models and snippets that a parent passes next to the props of a child. */
export const channelsKey: unique symbol = Symbol("meeko.channels");

/** Models and snippets that a parent passes to one child instance. */
export interface ComponentChannels {
  readonly models: Readonly<Record<string, unknown>>;
  readonly snippets: Readonly<Record<string, unknown>>;
}

/**
 * Adds the models and snippets of a component tag to its props object, a fresh literal of the
 * generated code. The key is enumerable so `{ ...defaults, ...props }` keeps it.
 */
export function withChannels<Props extends object>(props: Props, models: Record<string, unknown> | undefined, snippets: Record<string, unknown> | undefined): Props {
  if (!models && !snippets) return props;
  const channels: ComponentChannels = { models: models ?? {}, snippets: snippets ?? {} };
  return Object.assign(props, { [channelsKey]: channels });
}

/** Channels of a props object, if its parent passed any. */
export function readChannels(props: object): ComponentChannels | undefined {
  return (props as { [channelsKey]?: ComponentChannels })[channelsKey];
}

/**
 * Whether two reads of a component tag pass the same channels. Models are signals and compare by
 * identity. A snippet is a new function on each read but its content is reactive by itself, so
 * only the set of snippet names counts.
 */
export function sameChannels(first: object, second: object): boolean {
  const before = readChannels(first);
  const after = readChannels(second);
  if (!before || !after) return before === after;
  const models = Object.keys(before.models);
  if (models.length !== Object.keys(after.models).length || models.some((name) => !Object.hasOwn(after.models, name) || !Object.is(before.models[name], after.models[name]))) return false;
  const snippets = Object.keys(before.snippets);
  return snippets.length === Object.keys(after.snippets).length
    && snippets.every((name) => Object.hasOwn(after.snippets, name) && (before.snippets[name] === undefined) === (after.snippets[name] === undefined));
}

/** Any props or channels, for a component whose type is `any` or `never`. */
type LooseChannel = { readonly [name: string]: unknown };

/** `__meekoChannels` of a compiled module; `null` channels for a module without one. */
export type ChannelsOf<Module> = Module extends { readonly __meekoChannels: infer Channels }
  ? Channels
  : { readonly models: null; readonly snippets: null };

/** Models that a component tag may pass: `Signal<T>` by name, optional when the child has a default. */
export type ModelInputs<Module> = 0 extends 1 & Module ? LooseChannel : [Module] extends [never] ? LooseChannel
  : ChannelsOf<Module> extends { readonly models: infer Models } ? ([Models] extends [null] ? NoModels : Models) : never;

/** Snippets that a component tag may pass, by name, with the child's optionality. */
export type SnippetPresence<Module> = 0 extends 1 & Module ? LooseChannel : [Module] extends [never] ? LooseChannel
  : ChannelsOf<Module> extends { readonly snippets: infer Snippets } ? ([Snippets] extends [null] ? NoSnippets : { [K in keyof Snippets]: true }) : never;

/** Modelos de un componente sin defineModel: cualquier nombre falla con este mensaje. */
export type NoModels = { readonly [name: string]: "this component declares no defineModel" };
/** Snippets de un componente sin defineSnippets: cualquier nombre falla con este mensaje. */
export type NoSnippets = { readonly [name: string]: "this component declares no defineSnippets, so it accepts no children or <snippet>" };

/** Snippets que puede pasar una etiqueta de componente, como valores `Snippet` y con la opcionalidad del hijo. */
export type SnippetInputs<Module> = 0 extends 1 & Module ? LooseChannel : [Module] extends [never] ? LooseChannel
  : ChannelsOf<Module> extends { readonly snippets: infer Snippets } ? ([Snippets] extends [null] ? NoSnippets : Snippets) : never;

/** Cualquier valor de prop; el tipo función da `any` a los parámetros de un manejador sin tipo propio. */
type AnyPropValue = ((...args: any[]) => unknown) | {} | null | undefined;

/**
 * Props cuyo nombre empieza por `on` que una etiqueta de componente puede pasar además de las
 * declaradas. Las demás props se comprueban exactas: una desconocida es una propiedad sobrante,
 * también junto a props conocidas, y los literales conservan su tipo. Estos nombres se comprueban
 * aparte, con `EventNames`, así que un `on:evento` desconocido da un único error y su manejador
 * recibe parámetros `any` en lugar de un segundo error por `any` implícito.
 */
export type ExtraProps = { readonly [name: `on${string}`]: AnyPropValue };

/**
 * Props que acepta una etiqueta de componente: una prop opcional admite también `undefined`, que
 * Meeko trata como una prop ausente (con `exactOptionalPropertyTypes`, `label?: string` no lo
 * admitiría en `bind:label="cond ? 'x' : undefined"`). Las props obligatorias y las firmas de índice
 * no cambian, así que una prop desconocida sigue siendo una propiedad sobrante.
 */
export type TagProps<Props> = Props extends unknown
  ? { [K in keyof Props]: {} extends Record<K, unknown> ? Props[K] : {} extends Pick<Props, K> ? Props[K] | undefined : Props[K] }
  : never;

/** Todos los nombres de prop de un tipo de props, también de cada miembro de una unión. */
type PropNames<Props> = Props extends unknown ? keyof Props : never;

/**
 * Nombres que empiezan por `on` de una etiqueta de componente, como `on:evento`: uno que el
 * componente no declara es una propiedad sobrante.
 */
export type EventNames<Props> = { readonly [K in PropNames<Props>]?: unknown };

declare const tagExposed: unique symbol;

/**
 * Props de una etiqueta de componente, con sus modelos y snippets, ya comprobadas contra el
 * componente. Su tipo sólo lleva el valor que la instancia expone a un `ref:` del padre.
 */
export interface TagInput<Exposed> {
  readonly [tagExposed]?: Exposed;
}

/** Valor que expone la instancia de una etiqueta de componente comprobada, a partir de su `TagInput`. */
export type TagExposed<Input> = Input extends TagInput<infer Exposed> ? Exposed : null;

/** `true` cuando `T` es una unión de dos o más miembros. */
type IsUnion<T, Whole = T> = T extends unknown ? ([Whole] extends [T] ? false : true) : never;

/** Props de un módulo de componente; en una unión, la intersección de las de sus miembros. */
type PropsOf<Module> = [Module] extends [{ readonly renderToString: (props: infer Props, ...rest: never[]) => unknown }] ? Props : LooseChannel;

/** Comprobación de etiqueta de un módulo tipado sólo como componente: props, canales y valor expuesto. */
type ModuleTag<Module> = (props: TagProps<PropsOf<Module>> & ExtraProps, events: NoInfer<EventNames<PropsOf<Module>>>, models: NoInfer<ModelInputs<Module>>, snippets: NoInfer<SnippetInputs<Module>>) => TagInput<ExposedOf<Module>>;

/** Comprobación de etiqueta de un componente `any`: todo pasa y los manejadores reciben parámetros `any`. */
type LooseTag = (props: { readonly [name: string]: AnyPropValue }, events: any, models: any, snippets: any) => TagInput<any>;

/**
 * Comprobación de una etiqueta de componente. Un módulo compilado declara la suya en `__meekoTag`,
 * genérica si el componente lo es: una sola llamada infiere sus parámetros de tipo a partir de las
 * props y con ellos tipa los manejadores `on:evento`, los modelos, los snippets y el valor expuesto.
 * Una unión de componentes, un valor tipado como `Component<Props>` o `any` reciben una construida
 * a partir de la forma del módulo.
 */
export type ComponentTag<Module> = 0 extends 1 & Module ? LooseTag : [Module] extends [never] ? LooseTag
  : true extends IsUnion<Module> ? ModuleTag<Module>
  : Module extends { readonly __meekoTag: infer Tag } ? Tag : ModuleTag<Module>;

/** Modelos, snippets o nombres de evento vacíos de una etiqueta; entonces la etiqueta no pasa canales. */
export const noChannels: {} = Object.freeze({});

function tagInput(props: object, _events: object, models: Record<string, unknown>, snippets: Record<string, unknown>): object {
  return withChannels(props, models === noChannels ? undefined : models, snippets === noChannels ? undefined : snippets);
}

/**
 * Comprobación y runtime de una etiqueta de componente: `componentTag(() => Componente)(props,
 * eventos, modelos, snippets)` añade los modelos y los snippets al objeto de props. Aquí nunca se
 * lee el componente; sólo tipa la llamada. Sólo para el código generado.
 */
export function componentTag<Module>(component: () => Module): ComponentTag<Module> {
  void component;
  return tagInput as unknown as ComponentTag<Module>;
}

/**
 * Type-only check of the models of a component tag; generated code never calls it. An unknown
 * name is an excess property; a missing required model fails on the tag.
 */
export function checkComponentModels<Module>(component: Module, models: NoInfer<ModelInputs<Module>>): void {
  void component;
  void models;
}

/** Type-only check of the snippets of a component tag, like `checkComponentModels`. */
export function checkComponentSnippets<Module>(component: Module, snippets: NoInfer<SnippetPresence<Module>>): void {
  void component;
  void snippets;
}
