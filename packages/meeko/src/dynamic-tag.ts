/**
 * Runtime and types behind `<component is>` with an HTML tag and the `bind="obj"` directive.
 *
 * `<component is="expression">` renders an element when the expression is a tag name and a
 * component otherwise. The tag is checked here, in SSR and in the browser, before any HTML is
 * built from it: only the elements of the HTML data that can hold template content qualify, so
 * neither `<script>` nor a string with markup can reach the output through the tag name.
 *
 * `bind="obj"` writes the keys of an object as attributes of an element, or passes them as props of
 * a component. Keys that start with `on` are rejected: event handlers never come from data.
 */
import { elementAccepts, elementAttributeNames } from "./html-attributes.js";
import type { AttributeNameOf, AttributeValue, HtmlTagName, Words } from "./html-attributes.js";
import { attributeValue, escapeHtml } from "./server.js";
import type { ElementOf } from "./element-refs.js";
import type { ExposedOf } from "./expose.js";

/** Elements that `<component is>` refuses: document metadata, scripts, embedded documents and raw text. */
const forbiddenTagNames = "base body embed fencedframe head html iframe link meta noscript object param script slot style template textarea title";

type ForbiddenTagName = Words<typeof forbiddenTagNames>;

/**
 * Etiqueta HTML que `<component is>` puede renderizar: un elemento de los datos HTML de Meeko (MDN)
 * que no sea de metadatos, de script, de documento incrustado ni de texto sin formato. Quedan fuera
 * `script`, `style`, `iframe`, `object`, `embed`, `template`, `slot`, `textarea`, `title`, `base`,
 * `link`, `meta`, `head`, `html`, `body`, `noscript`, `param` y `fencedframe`.
 *
 * @since 1.5.0
 * @example
 * ```html
 * <script lang="ts">
 * import type { TagName } from "@meekojs/meeko";
 * // Sin contenido, también vale una etiqueta vacía como "hr" o "img".
 * const props = defineProps<{ as: TagName; label: string }>();
 * </script>
 * <template><component is="props.as" bind:title="props.label" /></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#etiquetas-html-en-component-is
 */
export type TagName = Exclude<HtmlTagName, ForbiddenTagName>;

/** Tags without content: `<component is>` rejects them when it has children (MEEK031). */
export type VoidTagName = "area" | "br" | "col" | "hr" | "img" | "input" | "source" | "track" | "wbr";

/**
 * Atributos que acepta `bind="obj"` en un elemento `Tag`: los globales (`class`, `id`, `role`,
 * `aria-*`, `data-*`…) y los propios de la etiqueta según los datos HTML de Meeko. Con una unión de
 * etiquetas vale cualquier atributo de alguna de ellas; un valor `null`, `undefined` o `false` no
 * escribe el atributo. No admite claves `on*`: los manejadores no se crean desde datos.
 *
 * @typeParam Tag Etiqueta o unión de etiquetas del elemento.
 * @since 1.5.0
 * @example
 * ```html
 * <script lang="ts">
 * import { computed } from "@meekojs/meeko";
 * import type { ElementAttributes } from "@meekojs/meeko";
 * const props = defineProps<{ href?: string; busy: boolean }>();
 * const state = computed((): ElementAttributes<"a" | "button"> => ({ "aria-busy": props.busy, "data-kind": props.href ? "link" : "action" }));
 * </script>
 * <template><component is="props.href ? 'a' : 'button'" bind="state.value" bind:href="props.href">Abrir</component></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#atributos-en-bloque-con-bind
 */
export type ElementAttributes<Tag extends string = TagName> = { readonly [Name in AttributeNameOf<Tag>]?: AttributeValue };

const voidTags = new Set(["area", "br", "col", "hr", "img", "input", "source", "track", "wbr"]);

let allowedTags: ReadonlySet<string> | undefined;

/** Whether `value` is a tag that `<component is>` may render. */
export function isTagName(value: unknown): value is TagName {
  if (typeof value !== "string") return false;
  allowedTags ??= new Set(Object.keys(elementAttributeNames).filter((tag) => !forbiddenTagNames.split(" ").includes(tag)));
  return allowedTags.has(value);
}

/** Whether `tag` is an element without content, such as `img`. */
export function isVoidTag(tag: string): boolean {
  return voidTags.has(tag);
}

/** A short, inert description of a rejected value for an error message. */
function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  return value === null ? "null" : typeof value;
}

/**
 * The tag of `<component is>`, checked: an allowed HTML tag, without content when it is void, and
 * never inside `<svg>`. Throws a `TypeError` with MEEK112 (or MEEK031) otherwise, before any HTML
 * is built from it.
 */
export function dynamicTagName(value: unknown, content: boolean, svg = false): TagName {
  if (svg) throw new TypeError(`MEEK112: <component is> dentro de <svg> sólo admite componentes, no la etiqueta ${describe(value)}`);
  if (!isTagName(value)) {
    throw new TypeError(`MEEK112: <component is> no puede renderizar ${describe(value)}: is debe ser un componente o una etiqueta HTML permitida (no script, style, iframe, object, embed, template, textarea…)`);
  }
  if (content && voidTags.has(value)) throw new TypeError(`MEEK031: <${value}> no admite contenido; quita el contenido de <component is> o elige otra etiqueta`);
  return value;
}

/** Closing tag of `tag`; a void element has none. */
export function closeTag(tag: string): string {
  return voidTags.has(tag) ? "" : `</${tag}>`;
}

/** Tags of the value of `is`. */
export type TagPart<T> = Extract<T, string>;
/** Components of the value of `is`. */
export type ComponentPart<T> = Exclude<T, string>;

/** Value of `ref:` on `<component is>` whose expression is `T`: the element of a tag or the exposed value of a component. */
export type DynamicRefOf<T> = ElementOf<TagPart<T>, false> | ExposedOf<ComponentPart<T>>;

/** The value of `is` typed as its components, for the props check of the hydration. Returns `value`. */
export function componentPart<const T>(value: T): ComponentPart<T> {
  return value as ComponentPart<T>;
}

/** SSR of `<component is>` whose expression is always a tag: the element, without markers. */
export function renderElementTag<const T>(value: T, render: (tag: TagPart<T>) => string, content: boolean): string {
  return render(dynamicTagName(value, content) as TagPart<T>);
}

/**
 * SSR of `<component is>` whose expression may be a tag or a component: a tag renders the element
 * between the markers of the component region, so the browser can swap one for the other.
 */
export function renderDynamic<const T>(id: number, value: T, element: (tag: TagPart<T>) => string, component: (value: ComponentPart<T>) => string, content: boolean, svg = false): string {
  if (typeof value === "string") return `<!--meeko:component:${id}-->${element(dynamicTagName(value, content, svg) as TagPart<T>)}<!--/meeko:component:${id}-->`;
  return component(value as ComponentPart<T>);
}

/**
 * Type text of MEEK112 for the value of `is`: a tag that `<component is>` cannot render, any
 * `string`, a tag inside `<svg>`, or a void tag with content (MEEK031). Short, so that TypeScript
 * never truncates it.
 */
export type TagCheck<T, Content extends boolean, Svg extends boolean> = 0 extends 1 & T ? unknown
  : [TagPart<T>] extends [never] ? unknown
    : Svg extends true ? "MEEK112: dentro de <svg>, is sólo admite componentes"
      : string extends TagPart<T> ? "MEEK112: is es un string cualquiera; usa una unión de etiquetas, como 'a' | 'button'"
        : [Exclude<TagPart<T>, TagName>] extends [never]
          ? (Content extends true ? ([Extract<TagPart<T>, VoidTagName>] extends [never] ? unknown : `MEEK031: <${Extract<TagPart<T>, VoidTagName>}> no admite contenido`) : unknown)
          : `MEEK112: <${Exclude<TagPart<T>, TagName> & string}> no es una etiqueta que <component is> pueda renderizar`;

/** Type-only check of the value of `is`; generated code never calls it. `check` maps to `is`. */
export function checkTag<const T, const Content extends boolean, const Svg extends boolean>(value: T, content: Content, svg: Svg, check: TagCheck<T, Content, Svg>): void {
  void value;
  void content;
  void svg;
  void check;
}

/** Type text of MEEK112 for an attribute that no possible tag of `is` accepts. */
export type TagAttributeCheck<Tag extends string, Name extends string, Accepted extends string> = 0 extends 1 & Tag ? unknown
  : [Tag] extends [never] ? unknown
    : [Extract<Tag, Accepted>] extends [never] ? `MEEK112: ${Name} no se aplica a ninguna etiqueta posible de is` : unknown;

/**
 * Whether the current tag of `<component is>` accepts the attribute `name`: `accepted` lists the
 * tags whose HTML data has it. The compiler only calls it for attributes that are not global. In
 * `meeko check`, `check` maps to the attribute and fails when no possible tag accepts it.
 */
export function tagAttribute<const Tag extends string, const Name extends string, const Accepted extends string>(tag: Tag, name: Name, accepted: readonly Accepted[], check?: TagAttributeCheck<Tag, Name, Accepted>): boolean {
  void name;
  void check;
  return (accepted as readonly string[]).includes(tag);
}

/** Type text of MEEK112 for a feature of `<component is>` that only a tag, or only a component, has. */
export type DynamicFeatureCheck<T, Feature extends string, Kind extends "tag" | "component"> = 0 extends 1 & T ? unknown
  : Kind extends "tag"
    ? ([ComponentPart<T>] extends [never] ? unknown : `MEEK112: ${Feature} sólo vale si is es una etiqueta HTML`)
    : ([TagPart<T>] extends [never] ? unknown : `MEEK112: ${Feature} sólo vale si is es un componente`);

/**
 * Type-only check of `<component is>` with an expression that may be a tag or a component: an
 * attribute that only an element has (`aria-label`, `html`) or that only a component has (`model`,
 * `<snippet>`) needs `is` to be of that kind. Generated code never calls it.
 */
export function checkDynamicFeature<const T, const Feature extends string, const Kind extends "tag" | "component">(value: T, feature: Feature, kind: Kind, check: DynamicFeatureCheck<T, Feature, Kind>): void {
  void value;
  void feature;
  void kind;
  void check;
}

/** Whether a key of `bind="obj"` names an event handler, which never comes from data. */
function isHandlerKey(key: string): boolean {
  return /^on/i.test(key);
}

/** Message of the error for a key of `bind="obj"` that names a handler. */
function handlerKeyError(key: string): TypeError {
  return new TypeError(`MEEK113: bind="…" no admite la clave ${JSON.stringify(key)}: un manejador de eventos no se crea desde datos; usa on:evento`);
}

/**
 * A type error whose text carries a Meeko code: an object with that text as its only key, which no
 * value is assignable to. Unlike a string literal type, it never reduces the whole object to `never`.
 */
type TypeMessage<Text extends string> = { readonly [Key in Text]: never };

/** Type text of MEEK113 for a key of `bind="obj"` on an element. */
export type AttributeSpreadCheck<T, Tag extends string> = {
  readonly [K in keyof T]: K extends string
    ? Lowercase<K> extends `on${string}` ? TypeMessage<"MEEK113: bind no admite claves on*; usa on:evento">
      : K extends `data-meeko${string}` ? TypeMessage<"MEEK113: data-meeko* está reservado a Meeko">
        : string extends K ? AttributeValue
          : K extends AttributeNameOf<Tag> ? AttributeValue
            : TypeMessage<`MEEK113: ${K} no es un atributo de la etiqueta`>
    : never;
};

/** Explicit `class` and `style` of an element with `bind="obj"`, which the spread combines with its own. */
export interface SpreadExplicit {
  readonly class?: unknown;
  readonly style?: unknown;
}

const attributeName = /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/;

function styleText(value: string | null): string {
  return value === null ? "" : value.trim().replace(/;+$/, "").trim();
}

/**
 * Attributes of `bind="obj"` on an element, in the order they are written: the combined `class`
 * and `style`, then the other keys. `excluded` are the names the element sets itself, which win;
 * `accepts` filters by the current tag of `<component is>`. `undefined`, `null` and `false` leave
 * a key out, as with `bind:name`. `class` joins the explicit classes and the object's; `style`
 * writes the object's declarations first, so the explicit ones win.
 */
export function spreadEntries<T extends object | null | undefined, const Tag extends string>(tag: Tag, value: T & NoInfer<T extends object ? AttributeSpreadCheck<T, Tag> : unknown>, excluded: readonly string[], explicit?: SpreadExplicit, accepts?: (tag: string, name: string) => boolean): Array<readonly [string, string]> {
  if (value !== null && value !== undefined && typeof value !== "object") {
    throw new TypeError(`MEEK113: bind="…" espera un objeto de atributos, no ${typeof value}`);
  }
  const source = (value ?? {}) as Record<string, unknown>;
  const entries: Array<readonly [string, string]> = [];
  // HTML attribute names have no case: `ID` is `id`, and `Data-Meeko` is reserved like `data-meeko`.
  const own = (name: string): string | null => {
    const key = Object.keys(source).find((candidate) => candidate.toLowerCase() === name);
    return key === undefined ? null : attributeValue(name, source[key]);
  };
  const skipped = new Set(excluded.map((name) => name.toLowerCase()));
  const classes = [attributeValue("class", explicit?.class), own("class")].filter((item): item is string => Boolean(item));
  if (classes.length) entries.push(["class", classes.join(" ")]);
  const styles = [styleText(own("style")), styleText(attributeValue("style", explicit?.style))].filter(Boolean);
  if (styles.length) entries.push(["style", styles.join("; ")]);
  for (const key of Object.keys(source)) {
    if (isHandlerKey(key)) throw handlerKeyError(key);
    const name = key.toLowerCase();
    if (name.startsWith("data-meeko")) throw new TypeError(`MEEK113: bind="…" no admite ${JSON.stringify(key)}: data-meeko* está reservado a Meeko`);
    if (name === "class" || name === "style" || skipped.has(name)) continue;
    if (!attributeName.test(key)) throw new TypeError(`MEEK113: bind="…" no admite ${JSON.stringify(key)}: no es un nombre de atributo`);
    if (accepts && !accepts(tag, key)) continue;
    const resolved = attributeValue(key, source[key]);
    if (resolved === null) continue;
    // One attribute per name, also for `id` and `ID` in the same object.
    skipped.add(name);
    entries.push([key, resolved]);
  }
  return entries;
}

/** SSR of `bind="obj"` on an element: its attributes, escaped. */
export function renderSpread(entries: ReadonlyArray<readonly [string, string]>): string {
  return entries.map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join("");
}

/** `accepts` of {@link spreadEntries} for `<component is>`: the attribute data of the current tag. */
export function tagAccepts(tag: string, name: string): boolean {
  return elementAccepts(tag, name);
}

/** Prop names of a component module; any name for `any`, `never` or a value that is no module. */
type PropNameOf<M> = 0 extends 1 & M ? string : [M] extends [never] ? string
  : [M] extends [{ readonly renderToString: (props: infer Props, ...rest: never[]) => unknown }] ? (Props extends unknown ? keyof Props : never) : string;

/** Type text of MEEK113 for a key of `bind="obj"` on a component. */
export type PropsSpreadCheck<T, M> = {
  readonly [K in keyof T]: K extends string
    ? Lowercase<K> extends `on${string}` ? TypeMessage<"MEEK113: bind no admite claves on*; usa on:evento">
      : string extends K ? unknown
        : K extends PropNameOf<M> ? unknown
          : TypeMessage<`MEEK113: ${K} no es una prop del componente`>
    : never;
};

/**
 * Props of `bind="obj"` on a component tag or a `<component is>` with a component: a copy of the
 * object without its `undefined` keys, which Meeko treats as absent props. The generated code
 * spreads it before the explicit props, which win. `component` only types the check.
 */
export function spreadProps<M, T extends object | null | undefined>(component: () => M, value: T & NoInfer<T extends object ? PropsSpreadCheck<T, M> : unknown>): NoInfer<T> {
  void component;
  if (value === null || value === undefined) return {} as T;
  if (typeof value !== "object") throw new TypeError(`MEEK113: bind="…" espera un objeto de props, no ${typeof value}`);
  const props: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isHandlerKey(key)) throw handlerKeyError(key);
    if (item !== undefined) props[key] = item;
  }
  return props as T;
}
