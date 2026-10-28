import { existsSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import type * as CSS from "csstype";
import type { AtRule, ChildNode, Container, Helpers, Plugin, Result, Root } from "postcss";
import selectorParser from "postcss-selector-parser";
import { loadUtilityModule } from "./module-loader.js";

/**
 * Valor de una declaración generada: una cadena se escribe tal cual (puede llevar
 * `!important`) y un número se convierte a texto sin añadir unidades (`opacity: 0.5`,
 * `z-index: 10`; escriba `"4px"` para longitudes).
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { UtilityValue } from "@meekojs/meeko/postcss";
 *
 * const opacity: UtilityValue = 0.5;
 * const padding: UtilityValue = "0.5rem 1rem";
 * ```
 */
export type UtilityValue = string | number;

/** Longitud de csstype: una cadena con unidad (`"4px"`, `"1rem"`) o el `0` sin unidad. */
type CssLength = (string & {}) | 0;

/** Un valor con `!important`; también para las propiedades que csstype limita a palabras clave. */
type ImportantValue = `${string}!important`;

/** Un valor de csstype, con `!important`, un array de valores de respaldo o `undefined` para omitirlo. */
type DeclaredValue<Value> =
  | Exclude<Value, undefined>
  | ImportantValue
  | readonly (Exclude<Value, undefined> | ImportantValue)[]
  | undefined;

/** Las propiedades de csstype con sus valores declarables; conserva su documentación en el editor. */
type DeclaredProperties<Properties> = { readonly [Property in keyof Properties]?: DeclaredValue<Properties[Property]> };

/**
 * Declaraciones de una regla como objeto, tipadas con
 * [csstype](https://github.com/frenic/csstype): el editor autocompleta las propiedades y sus
 * palabras clave, y una propiedad mal escrita es un error de tipos. Las longitudes y los tiempos
 * son cadenas con unidad (`"4px"`, `"200ms"`), salvo el `0`; los números sólo valen en las
 * propiedades sin unidad (`opacity`, `zIndex`, `flexGrow`, `lineHeight`…). Para lo que csstype
 * no conozca, use el helper `css`.
 *
 * Las claves en camelCase pasan a kebab-case (`backgroundColor` → `background-color`,
 * `WebkitAppearance` → `-webkit-appearance`); las claves en kebab-case y las propiedades
 * personalizadas `--*` se escriben tal cual. `undefined` omite la declaración y un array
 * escribe una declaración por valor, en orden, para los valores de respaldo.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { UtilityDeclarations } from "@meekojs/meeko/postcss";
 *
 * const card: UtilityDeclarations = {
 *   "--card-gap": "1rem",
 *   borderRadius: "1rem",
 *   display: ["-webkit-box", "flex"],
 *   position: "relative !important",
 *   opacity: 0.9,
 *   outline: undefined,
 * };
 * ```
 */
export interface UtilityDeclarations
  extends DeclaredProperties<CSS.Properties<CssLength>>, DeclaredProperties<CSS.PropertiesHyphen<CssLength>> {
  readonly [property: `--${string}`]: UtilityValue | readonly UtilityValue[] | undefined;
}

/** Los descriptores de `@counter-style`, `@font-face`, `@font-palette-values`, `@page`, `@property` y `@view-transition`. */
type AtRuleDescriptors =
  & CSS.AtRule.CounterStyle<CssLength> & CSS.AtRule.CounterStyleHyphen<CssLength>
  & CSS.AtRule.FontFace<CssLength> & CSS.AtRule.FontFaceHyphen<CssLength>
  & CSS.AtRule.FontPaletteValues<CssLength> & CSS.AtRule.FontPaletteValuesHyphen<CssLength>
  & CSS.AtRule.Page<CssLength> & CSS.AtRule.PageHyphen<CssLength>
  & CSS.AtRule.Property<CssLength> & CSS.AtRule.PropertyHyphen<CssLength>
  & CSS.AtRule.ViewTransition<CssLength> & CSS.AtRule.ViewTransitionHyphen<CssLength>;

/**
 * Declaraciones del cuerpo de una at-rule creada con {@link UtilityHelpers.atRule}: las
 * propiedades de {@link UtilityDeclarations} y los descriptores de `@font-face` (`src`,
 * `fontDisplay`, `unicodeRange`…), `@property` (`syntax`, `inherits`, `initialValue`),
 * `@page`, `@counter-style`, `@font-palette-values` y `@view-transition`, tipados con csstype.
 * Es un subtipo de {@link UtilityDeclarations}.
 *
 * @since 1.3.0
 * @example
 * ```ts
 * import { defineUtilities, type UtilityAtRuleDeclarations } from "@meekojs/meeko/postcss";
 *
 * const inter: UtilityAtRuleDeclarations = {
 *   fontFamily: "Inter",
 *   src: "url('/fonts/inter.woff2') format('woff2')",
 *   fontDisplay: "swap",
 * };
 * export default defineUtilities(({ atRule }) => [
 *   atRule("font-face", "", inter),
 *   atRule("property", "--angle", { syntax: "'<angle>'", inherits: "false", initialValue: "0deg" }),
 * ]);
 * ```
 */
export interface UtilityAtRuleDeclarations
  extends UtilityDeclarations, DeclaredProperties<Omit<AtRuleDescriptors, keyof UtilityDeclarations>> {}

/**
 * Una regla creada con {@link UtilityHelpers.rule}: un selector, sus declaraciones y sus
 * reglas hijas, que se emiten anidadas (anidamiento CSS nativo; use `&` en el selector hijo).
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import { defineUtilities, type UtilityRule } from "@meekojs/meeko/postcss";
 *
 * export default defineUtilities(({ rule }) => {
 *   const card: UtilityRule = rule(".card", { padding: "1rem" }, rule("&:hover", { opacity: 0.9 }));
 *   return [card];
 * });
 * ```
 */
export interface UtilityRule {
  /** Discriminante: una regla con selector. */
  readonly kind: "rule";
  /** Selector de la regla; dentro de otra regla puede usar `&`. */
  readonly selector: string;
  /** Declaraciones de la regla, antes de sus hijas. */
  readonly declarations: UtilityDeclarations;
  /** Reglas, at-rules y CSS anidados en la regla. */
  readonly children: readonly UtilityOutput[];
}

/**
 * Una at-rule creada con {@link UtilityHelpers.atRule}, por ejemplo `@media` o `@supports`.
 * Sin cuerpo se emite como sentencia (`@layer a, b;`).
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import { defineUtilities, type UtilityAtRule } from "@meekojs/meeko/postcss";
 *
 * export default defineUtilities(({ atRule, rule }) => {
 *   const wide: UtilityAtRule = atRule("media", "(min-width: 48rem)", rule(".stack", { flexDirection: "row" }));
 *   return wide;
 * });
 * ```
 */
export interface UtilityAtRule {
  /** Discriminante: una at-rule como `@media` o `@supports`. */
  readonly kind: "atrule";
  /** Nombre sin `@`: `media`, `supports`, `container`… */
  readonly name: string;
  /** Parámetros tras el nombre, por ejemplo `(min-width: 48rem)`. */
  readonly params: string;
  /** Declaraciones del cuerpo, para `@font-face` o `@property`. */
  readonly declarations: UtilityAtRuleDeclarations;
  /** Reglas, at-rules y CSS del cuerpo. */
  readonly children: readonly UtilityOutput[];
  /** `false` cuando la at-rule es una sentencia sin `{ }`. */
  readonly block: boolean;
}

/**
 * CSS literal creado con {@link UtilityHelpers.css}; PostCSS lo analiza al expandir `@utilities`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import { defineUtilities, type UtilityCss } from "@meekojs/meeko/postcss";
 *
 * export default defineUtilities(({ css }) => {
 *   const keyframes: UtilityCss = css`@keyframes fade { from { opacity: 0 } }`;
 *   return keyframes;
 * });
 * ```
 */
export interface UtilityCss {
  /** Discriminante: CSS literal que se analiza con PostCSS. */
  readonly kind: "css";
  /** El texto CSS. */
  readonly css: string;
}

/**
 * Un nodo que devuelven los helpers de {@link UtilityHelpers}. Sólo cuentan los nodos que
 * crean los helpers; un objeto con la misma forma escrito a mano es un error.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import { defineUtilities, type UtilityNode } from "@meekojs/meeko/postcss";
 *
 * export default defineUtilities(({ rule, css }) => {
 *   const nodes: UtilityNode[] = [rule(".a", { color: "red" }), css`.b { color: blue }`];
 *   return nodes;
 * });
 * ```
 */
export type UtilityNode = UtilityRule | UtilityAtRule | UtilityCss;

/**
 * Lo que devuelve una función de utilidades: un nodo, un array de salidas (anidado a
 * cualquier profundidad, se aplana en orden) o `null`, `false` y `undefined`, que se omiten.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import { defineUtilities, type UtilityOutput } from "@meekojs/meeko/postcss";
 *
 * export default defineUtilities(({ rule }) => {
 *   const dark = false;
 *   const output: UtilityOutput = [rule(".a", { color: "red" }), dark && rule(".b", { color: "white" })];
 *   return output;
 * });
 * ```
 */
export type UtilityOutput = UtilityNode | readonly UtilityOutput[] | null | false | undefined;

/**
 * Helpers que recibe la función de utilidades. Crean nodos que el plugin valida y convierte
 * en CSS: un selector, una propiedad o un valor no válidos detienen el build con la línea
 * del `@utilities`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import { defineUtilities, type UtilityHelpers } from "@meekojs/meeko/postcss";
 *
 * const sizes = ({ rule, atRule }: UtilityHelpers) => [
 *   rule(".button[data-size='sm']", { padding: "0.25rem 0.5rem" }),
 *   atRule("media", "(pointer: coarse)", rule(".button", { minHeight: "2.75rem" })),
 * ];
 * export default defineUtilities(sizes);
 * ```
 */
export interface UtilityHelpers {
  /**
   * Crea una regla. El segundo argumento es un objeto de declaraciones o la primera hija;
   * las demás hijas (reglas con `&`, `atRule`, `css`, arrays) se anidan dentro.
   */
  rule(selector: string, declarations: UtilityDeclarations, ...children: UtilityOutput[]): UtilityRule;
  rule(selector: string, ...children: UtilityOutput[]): UtilityRule;
  /**
   * Crea una at-rule, como `@media`, `@supports`, `@container`, `@font-face` o `@property`.
   * `name` va sin `@`. Sin cuerpo (sólo `name` y `params`) se emite como sentencia.
   */
  atRule(name: string, params: string, declarations: UtilityAtRuleDeclarations, ...children: UtilityOutput[]): UtilityAtRule;
  atRule(name: string, params: string, ...children: UtilityOutput[]): UtilityAtRule;
  /**
   * CSS literal, como cadena o plantilla etiquetada; se analiza con PostCSS. Las barras
   * invertidas se conservan (`content: "\201C"`).
   */
  css(strings: TemplateStringsArray | string, ...values: readonly unknown[]): UtilityCss;
}

/**
 * La función que exporta por defecto un módulo de `@utilities`. Recibe los
 * {@link UtilityHelpers} y devuelve, o promete, las reglas a generar.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { UtilityFunction } from "@meekojs/meeko/postcss";
 *
 * const utilities: UtilityFunction = async ({ rule }) => {
 *   const steps = await Promise.resolve([1, 2, 3]);
 *   return steps.map((step) => rule(`.gap-${step}`, { gap: `${step * 0.25}rem` }));
 * };
 * export default utilities;
 * ```
 */
export type UtilityFunction = (helpers: UtilityHelpers) => UtilityOutput | Promise<UtilityOutput>;

/**
 * Declara el export por defecto de un módulo de `@utilities` con tipos para los helpers.
 * Devuelve la misma función; exportar una función sin `defineUtilities` también funciona.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * // app/styles/utilities/color.ts
 * import { defineUtilities } from "@meekojs/meeko/postcss";
 *
 * export default defineUtilities(({ rule }) =>
 *   ["gray", "blue", "red"].map((name) =>
 *     rule(`.color[data-color='${name}']`, Object.fromEntries(
 *       Array.from({ length: 12 }, (_, i) => [`--color-${i + 1}`, `var(--${name}-${i + 1})`])))));
 * ```
 */
export function defineUtilities(utilities: UtilityFunction): UtilityFunction {
  return utilities;
}

/**
 * Opciones de {@link meekoUtilities}.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import { meekoUtilities, type MeekoUtilitiesOptions } from "@meekojs/meeko/postcss";
 *
 * const options: MeekoUtilitiesOptions = { root: process.cwd() };
 * export default { plugins: [meekoUtilities(options)] };
 * ```
 */
export interface MeekoUtilitiesOptions {
  /**
   * Carpeta desde la que se resuelven las rutas de `@utilities` cuando la hoja no tiene
   * archivo (CSS procesado sin la opción `from` de PostCSS). Por defecto, `process.cwd()`.
   * Con archivo, la ruta siempre es relativa a la hoja que contiene la at-rule.
   */
  readonly root?: string;
}

const pluginName = "meeko-utilities";
const moduleExtensions = new Set([".ts", ".mts", ".js", ".mjs"]);
const usage = `@utilities "./utilidades.ts" layer(utilities);`;
/** Nodes the helpers created; anything else in the output is rejected. */
const createdNodes = new WeakSet<object>();
/** Modules already warned about loading without rolldown, once per process. */
const nativeWarnings = new Set<string>();

/**
 * Plugin de PostCSS que expande `@utilities "<ruta>" [layer(<nombre>)];` con las reglas que
 * genera la función exportada por un módulo `.ts`, `.mts`, `.js` o `.mjs`. La ruta es
 * relativa a la hoja que contiene la at-rule, también en un `<style>` de un `.meeko`;
 * `layer(x)` envuelve el resultado en `@layer x { … }`.
 *
 * Con Vite 8 el módulo se empaqueta con rolldown en cada cambio, así que editarlo, o editar un
 * módulo local que importa, regenera el CSS en `meeko dev` sin reiniciar. Coloque el plugin
 * antes de `@tailwindcss/postcss` para que Tailwind vea las reglas generadas.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * // postcss.config.ts
 * import { meekoUtilities } from "@meekojs/meeko/postcss";
 *
 * export default { plugins: [meekoUtilities()] };
 * ```
 *
 * Y en `app/styles/main.css`:
 *
 * ```css
 * @utilities "./utilities/color.ts" layer(utilities);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#utilidades-generadas-con-typescript
 */
export function meekoUtilities(options: MeekoUtilitiesOptions = {}): Plugin {
  const plugin: Plugin = {
    postcssPlugin: pluginName,
    // `Once`, not an `AtRule` listener: plugins run in the configured order, so a plugin after
    // this one (Tailwind) sees the generated rules.
    async Once(root, { result, postcss }) {
      warnTailwindFirst(plugin, root, result);
      const atRules: AtRule[] = [];
      root.walkAtRules(/^utilities$/i, (atRule) => { atRules.push(atRule); });
      for (const atRule of atRules) await expandUtilities(atRule, result, postcss, options);
    },
  };
  return plugin;
}
meekoUtilities.postcss = true as const;

let tailwindOrderWarned = false;

/**
 * Tailwind 4 compiles a stylesheet that imports it into a new tree without the at-rules it does
 * not know: when it runs first, the `@utilities` of that stylesheet vanish without an error.
 * Warned once per process, since the at-rules are gone by the time this plugin runs.
 */
function warnTailwindFirst(plugin: Plugin, root: Root, result: Result): void {
  if (tailwindOrderWarned) return;
  const plugins = result.processor.plugins;
  const own = plugins.indexOf(plugin);
  const tailwind = plugins.findIndex((item) => "postcssPlugin" in item && /tailwindcss/.test(String(item.postcssPlugin)));
  if (own < 0 || tailwind < 0 || tailwind > own) return;
  tailwindOrderWarned = true;
  result.warn("meekoUtilities() se ejecuta después de Tailwind, que elimina los @utilities de las hojas que compila; "
    + "colóquelo antes de @tailwindcss/postcss en postcss.config", { plugin: pluginName, ...(root.first ? { node: root.first } : {}) });
}

interface UtilitiesParams { readonly path: string; readonly layer: string | undefined }

/** `"<path>"` or `'<path>'`, then an optional `layer` or `layer(<name>)`. */
function parseParams(params: string): UtilitiesParams | undefined {
  const match = /^\s*(["'])((?:(?!\1).)+)\1\s*(?:(layer)(?:\(\s*([^()]*?)\s*\))?)?\s*$/is.exec(params);
  if (!match) return undefined;
  return { path: match[2]!, layer: match[3] ? match[4] ?? "" : undefined };
}

/** The file of the stylesheet that contains `node`, without Vite's query (`Card.meeko?meeko-style=…`). */
function stylesheetFile(node: AtRule, result: Result): string | undefined {
  const file = node.source?.input.file ?? result.opts.from;
  return file ? file.replace(/\?.*$/s, "") : undefined;
}

async function expandUtilities(atRule: AtRule, result: Result, postcss: Helpers["postcss"], options: MeekoUtilitiesOptions): Promise<void> {
  if (atRule.nodes !== undefined) throw atRule.error(`@utilities no lleva bloque { }; escríbalo como ${usage}`);
  const params = parseParams(atRule.params);
  if (!params) throw atRule.error(`@utilities espera una ruta entre comillas y, opcionalmente, layer(<nombre>): ${usage}`);
  if (params.layer && !/^-?[_a-z][\w-]*(?:\.-?[_a-z][\w-]*)*$/i.test(params.layer)) {
    throw atRule.error(`@utilities: nombre de capa no válido "${params.layer}"`, { word: params.layer });
  }
  const stylesheet = stylesheetFile(atRule, result);
  const file = resolve(stylesheet ? dirname(stylesheet) : resolve(options.root ?? process.cwd()), params.path);
  if (!moduleExtensions.has(extname(file).toLowerCase())) {
    throw atRule.error(`@utilities carga módulos .ts, .mts, .js o .mjs, no "${params.path}"`, { word: params.path });
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw atRule.error(`@utilities no encuentra "${params.path}" (${file})`, { word: params.path });
  }
  let loaded: Awaited<ReturnType<typeof loadUtilityModule>>;
  try {
    loaded = await loadUtilityModule(file);
  } catch (error) {
    throw atRule.error(`@utilities no pudo cargar "${params.path}": ${errorMessage(error)}`, { word: params.path });
  }
  for (const dependency of loaded.files) {
    result.messages.push({ type: "dependency", plugin: pluginName, file: dependency, parent: stylesheet ?? "" });
  }
  if (!loaded.bundled && !nativeWarnings.has(file)) {
    nativeWarnings.add(file);
    result.warn(`@utilities cargó "${params.path}" con import() nativo porque no encontró rolldown (Vite 8): `
      + "los cambios en los módulos que importa no se recargan hasta reiniciar el proceso", { node: atRule, plugin: pluginName });
  }
  const utilities = loaded.exports.default;
  if (typeof utilities !== "function") {
    throw atRule.error(`"${params.path}" debe exportar por defecto una función: export default defineUtilities(({ rule }) => [...])`, { word: params.path });
  }
  let output: unknown;
  try {
    output = await (utilities as UtilityFunction)(helpers);
  } catch (error) {
    throw atRule.error(`"${params.path}" lanzó un error al generar las utilidades: ${errorMessage(error)}`, { word: params.path });
  }
  let nodes: ChildNode[];
  try {
    nodes = new Expander(postcss, atRule).expand(output, "la salida");
  } catch (error) {
    if (error instanceof UtilityError) throw atRule.error(`"${params.path}": ${error.message}`, { word: params.path });
    throw error;
  }
  if (params.layer !== undefined && nodes.length) {
    nodes = [postcss.atRule({ name: "layer", params: params.layer, nodes, raws: blockRaws(params.layer), ...(atRule.source ? { source: atRule.source } : {}) })];
  }
  if (nodes.length) atRule.replaceWith(nodes);
  else atRule.remove();
}

/** A space before `{` and a `;` after the last declaration; the indentation follows the stylesheet. */
function blockRaws(params: string): { afterName: string; between: string; semicolon: boolean } {
  return { afterName: params ? " " : "", between: " ", semicolon: true };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUtilityNode(value: unknown): value is UtilityNode {
  return typeof value === "object" && value !== null && createdNodes.has(value);
}

/** Splits `rule`/`atRule` arguments: a plain object first is the declarations, the rest are children. */
function body(args: readonly unknown[]): { declarations: UtilityAtRuleDeclarations; children: UtilityOutput[] } {
  const [first, ...rest] = args;
  if (typeof first === "object" && first !== null && !Array.isArray(first) && !isUtilityNode(first)) {
    return { declarations: first as UtilityAtRuleDeclarations, children: rest as UtilityOutput[] };
  }
  return { declarations: {}, children: args as UtilityOutput[] };
}

function created<T extends UtilityNode>(node: T): T {
  createdNodes.add(node);
  return Object.freeze(node);
}

const helpers: UtilityHelpers = {
  rule(selector: string, ...args: unknown[]): UtilityRule {
    return created({ kind: "rule", selector, ...body(args) });
  },
  atRule(name: string, params: string, ...args: unknown[]): UtilityAtRule {
    return created({ kind: "atrule", name, params, ...body(args), block: args.length > 0 });
  },
  css(strings: TemplateStringsArray | string, ...values: readonly unknown[]): UtilityCss {
    const text = typeof strings === "string"
      ? strings
      : strings.raw.reduce((css, part, index) => css + part + (index < values.length ? String(values[index]) : ""), "");
    return created({ kind: "css", css: text });
  },
};

/** An invalid node in the output; the plugin reports it at the `@utilities` line. */
class UtilityError extends Error {}

/** Turns the output of a utility function into PostCSS nodes, validating each part. */
class Expander {
  constructor(private readonly postcss: Helpers["postcss"], private readonly origin: AtRule) {}

  expand(output: unknown, where: string): ChildNode[] {
    if (output === null || output === undefined || output === false) return [];
    if (Array.isArray(output)) return output.flatMap((item: unknown) => this.expand(item, where));
    if (!isUtilityNode(output)) {
      const hint = typeof output === "string" ? "; envuelva el CSS literal con css`…`" : "; use rule(), atRule() o css`…`";
      throw new UtilityError(`${where} contiene ${describe(output)}, que no es un nodo de utilidades${hint}`);
    }
    if (output.kind === "css") return this.raw(output.css);
    if (output.kind === "rule") {
      const selector = this.selector(output.selector);
      const rule = this.postcss.rule({ selector, raws: { between: " ", semicolon: true }, ...this.sourceProps });
      this.fill(rule, output.declarations, output.children, `la regla "${selector}"`);
      return [rule];
    }
    const name = this.atRuleName(output.name);
    const params = this.atRuleParams(name, output.params);
    const atRule = this.postcss.atRule({ name, params, raws: output.block ? blockRaws(params) : { afterName: params ? " " : "" }, ...this.sourceProps });
    if (output.block) {
      atRule.nodes = [];
      this.fill(atRule, output.declarations, output.children, `@${name}${params ? ` ${params}` : ""}`);
    }
    return [atRule];
  }

  private fill(container: Container, declarations: UtilityDeclarations, children: readonly UtilityOutput[], where: string): void {
    if (typeof declarations !== "object" || declarations === null) throw new UtilityError(`${where}: las declaraciones deben ser un objeto`);
    for (const [key, value] of Object.entries(declarations)) {
      if (value === undefined) continue;
      const property = this.property(key, where);
      for (const item of Array.isArray(value) ? value as readonly unknown[] : [value]) container.append(this.declaration(property, item, where));
    }
    container.append(this.expand(children, where));
  }

  private property(key: string, where: string): string {
    const property = key.startsWith("--") ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^ms-/, "-ms-");
    const valid = key.startsWith("--") ? /^--[^\s:;{}()!'"]+$/.test(property) : /^-?[a-z_][a-z0-9_-]*$/.test(property);
    if (!valid) throw new UtilityError(`${where}: nombre de propiedad no válido "${key}"`);
    return property;
  }

  private declaration(property: string, value: unknown, where: string): ChildNode {
    let text: string;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new UtilityError(`${where}: ${property} tiene el valor ${value}, que no es un número finito`);
      text = String(value);
    } else if (typeof value === "string") {
      text = value;
    } else {
      throw new UtilityError(`${where}: ${property} tiene un valor ${describe(value)}; use una cadena, un número o undefined para omitirla`);
    }
    if (!text.trim() && !property.startsWith("--")) throw new UtilityError(`${where}: ${property} tiene un valor vacío`);
    // Parsed alone, a valid value is one declaration of the same property: this rejects `;`, braces
    // and unterminated strings that would leak into the next declaration.
    let parsed: ChildNode | undefined;
    try {
      const probe = this.postcss.parse(`a{${property}:${text}}`).first;
      if (probe?.type === "rule" && probe.nodes.length === 1) parsed = probe.first;
    } catch {
      parsed = undefined;
    }
    if (parsed?.type !== "decl" || parsed.prop !== property) {
      throw new UtilityError(`${where}: valor no válido para ${property}: ${JSON.stringify(text)}`);
    }
    return this.postcss.decl({ prop: property, value: parsed.value, important: parsed.important ?? false, ...this.sourceProps });
  }

  private selector(selector: unknown): string {
    if (typeof selector !== "string" || !selector.trim()) throw new UtilityError(`una regla tiene el selector ${describe(selector)}; use una cadena no vacía`);
    const trimmed = selector.trim();
    let valid = false;
    try {
      selectorParser().astSync(trimmed);
      const probe = this.postcss.parse(`${trimmed}{}`);
      valid = probe.nodes.length === 1 && probe.first?.type === "rule" && probe.first.selector === trimmed;
    } catch {
      valid = false;
    }
    if (!valid) throw new UtilityError(`selector no válido ${JSON.stringify(selector)}`);
    return trimmed;
  }

  private atRuleName(name: unknown): string {
    const bare = typeof name === "string" ? name.replace(/^@/, "") : "";
    if (!/^-?[a-z][\w-]*$/i.test(bare)) throw new UtilityError(`nombre de at-rule no válido ${describe(name)}`);
    return bare;
  }

  private atRuleParams(name: string, params: unknown): string {
    if (typeof params !== "string") throw new UtilityError(`@${name} tiene los parámetros ${describe(params)}; use una cadena`);
    const trimmed = params.trim();
    let valid = false;
    try {
      const probe = this.postcss.parse(`@${name} ${trimmed}{}`);
      valid = probe.nodes.length === 1 && probe.first?.type === "atrule" && probe.first.params === trimmed;
    } catch {
      valid = false;
    }
    if (!valid) throw new UtilityError(`parámetros no válidos para @${name}: ${JSON.stringify(params)}`);
    return trimmed;
  }

  private raw(text: unknown): ChildNode[] {
    if (typeof text !== "string") throw new UtilityError(`css recibió ${describe(text)}; use una cadena o una plantilla`);
    let parsed: ReturnType<Helpers["postcss"]["parse"]>;
    try {
      parsed = this.postcss.parse(text);
    } catch (error) {
      const reason = error instanceof Error && "reason" in error ? String((error as { reason: unknown }).reason) : errorMessage(error);
      const line = typeof (error as { line?: unknown }).line === "number" ? ` (línea ${(error as { line: number }).line} del css)` : "";
      throw new UtilityError(`css\`…\` no es CSS válido: ${reason}${line}`);
    }
    // Errors and source maps of the generated CSS point to the `@utilities` line.
    const source = this.origin.source;
    if (source) parsed.walk((node) => { node.source = source; });
    return [...parsed.nodes].map((node) => node.remove());
  }

  /** The `source` of every generated node: the `@utilities` at-rule. */
  private get sourceProps(): { source?: NonNullable<AtRule["source"]> } {
    return this.origin.source ? { source: this.origin.source } : {};
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "un array";
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (typeof value === "object") return "un objeto";
  return `${typeof value} ${String(value)}`;
}
