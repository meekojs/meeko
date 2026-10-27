import { basename, dirname, join, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import ts from "@typescript/typescript6";
import { applyAutoImports, discoverAutoImportsSync } from "../autoimports.js";
import type { AutoImport } from "../autoimports.js";
import { projectRoot } from "../compiler/project-root.js";
import { GenericError, parseGeneric, sectionAttribute } from "../compiler/generic.js";
import type { GenericParameters } from "../compiler/generic.js";
import { analyzePropsDefaults, PropsDefaultsError } from "../compiler/props.js";
import { freeIdentifiers } from "../compiler/composables.js";
import { templateEventDeclaration, templateEventType } from "../compiler/events.js";
import { scanInterpolations } from "../compiler/interpolation.js";
import { MeekoCompileError, parseSfc } from "../compiler/sfc.js";
import { analyzeServerScript } from "../compiler/server-script.js";
import type { ServerScript } from "../compiler/server-script.js";
import { pageRouteId, serverScriptTypes } from "../framework/server-script.js";
import type { SfcSection } from "../compiler/sfc.js";
import { attributeValueStart, decodeTemplateText, isCustomElementTag, parseTemplate } from "../compiler/template.js";
import type { TemplateNode } from "../compiler/template.js";
import { extractRouteRender } from "../framework/routes-discovery.js";

/** Tramo equivalente entre el componente y el archivo TypeScript virtual. */
export interface SourceSpan {
  sourceStart: number;
  sourceEnd: number;
  generatedStart: number;
  generatedEnd: number;
}

/** Autoimport que el editor omitió para poder seguir analizando el componente. */
export interface AutoImportProblem {
  readonly name: string;
  readonly kind: "ambiguous" | "unavailable";
  readonly message: string;
  readonly candidates: readonly AutoImport[];
}

/** Código TypeScript virtual de un componente y su mapa de posiciones. */
export interface VirtualComponent {
  readonly filename: string;
  readonly virtualFilename: string;
  readonly source: string;
  readonly code: string;
  readonly spans: readonly SourceSpan[];
  /** Autoimports descartados en modo tolerante; vacío en modo estricto. */
  readonly problems: readonly AutoImportProblem[];
  /**
   * The file has no `<script lang="ts">`: the first span is empty, at the start of the template,
   * and an edit that adds code there must also add the script tags.
   */
  readonly implicitScript?: true;
  /**
   * Documento virtual del bloque `<script server lang="ts">` de una página, si lo tiene. Es un
   * módulo TypeScript propio (`x.meeko.server.ts`) con los autoimports de servidor, o de cliente
   * si su `render` estático es `"client"`; sus tramos apuntan al bloque dentro del `.meeko`.
   */
  readonly server?: VirtualComponent | undefined;
  /**
   * Declarations of the page data in this document, from the exports of the page's top-level
   * `<script server>` code: each generated name and the export it stands for in the `.meeko`.
   */
  readonly serverExports?: readonly SourceSpan[];
  /** Etiquetas de componente (`<AppButton>`) de la plantilla, para hover, definición y completado. */
  readonly componentTags?: readonly ComponentTag[];
  /** Tramo fuente del nombre de evento de cada `on:evento` sobre un componente (`save` en `on:save`). */
  readonly componentEvents?: ReadonlyArray<{ readonly start: number; readonly end: number }>;
  /** Tramo fuente del nombre de cada `model:nombre` sobre un componente (`open` en `model:open`). */
  readonly componentModels?: ReadonlyArray<{ readonly start: number; readonly end: number }>;
  /** `<snippet name params>` dentro de un componente, para completar parámetros y hover. */
  readonly snippetTags?: readonly SnippetTag[];
  /** Tramo fuente del nombre de cada directiva `html` de un elemento, para el hover. */
  readonly htmlDirectives?: ReadonlyArray<{ readonly start: number; readonly end: number }>;
  toGenerated(offset: number): number | undefined;
  toSource(offset: number): number | undefined;
}

/** Etiqueta PascalCase de la plantilla y el `.meeko` al que se resuelve, si se conoce. */
export interface ComponentTag {
  readonly name: string;
  /** Inicio del nombre en la etiqueta de apertura. */
  readonly start: number;
  /** Inicio del nombre en la etiqueta de cierre, si existe. */
  readonly closeStart?: number;
  /** `.meeko` importado explícitamente o por autoimport. */
  readonly file?: string;
}

/** `<snippet name="x" params="a, b">` hijo de una etiqueta de componente. */
export interface SnippetTag {
  /** Valor de `name`. */
  readonly nameStart: number;
  readonly nameEnd: number;
  /** Valor de `params`, si existe. */
  readonly paramsStart?: number;
  readonly paramsEnd?: number;
}

/** Modelo semántico de un componente abierto en el editor. */
export interface EditorModel extends VirtualComponent {
  readonly service: ts.LanguageService;
  dispose(): void;
}

export interface VirtualComponentOptions {
  /** Registro de autoimports ya resuelto; por defecto se lee la configuración estática. */
  readonly registry?: readonly AutoImport[];
  /** Omite los autoimports ambiguos o fuera de ámbito y los informa en `problems`. */
  readonly tolerant?: boolean;
}

export interface EditorModelOptions extends VirtualComponentOptions {
  /** Opciones de TypeScript; por defecto se usan las del tsconfig del proyecto. */
  readonly compilerOptions?: ts.CompilerOptions;
}

/** Opciones resueltas de TypeScript para un proyecto Meeko. */
export interface ProjectCompilerOptions {
  readonly options: ts.CompilerOptions;
  /** Archivos TypeScript del proyecto según el tsconfig; vacío sin tsconfig. */
  readonly fileNames: readonly string[];
  readonly configFile?: string;
}

/** Ruta del documento TypeScript virtual asociado a un componente. */
export function virtualFilenameOf(filename: string): string {
  return `${resolve(filename).replaceAll("\\", "/")}.ts`;
}

/** Sufijo del documento virtual del bloque `<script server>` respecto al `.meeko`. */
export const serverVirtualSuffix = ".server.ts";

/** Ruta del documento TypeScript virtual del bloque `<script server>` de un componente. */
export function serverVirtualFilenameOf(filename: string): string {
  return `${resolve(filename).replaceAll("\\", "/")}${serverVirtualSuffix}`;
}

/** Ámbito de autoimports del bloque server: el de cliente sólo si su `render` estático es `"client"`. */
function routeBlockTarget(filename: string, content: string): "client" | "server" {
  // Opciones no estáticas las informa el descubrimiento de rutas; aquí basta con un ámbito.
  try { return extractRouteRender(filename, content) === "client" ? "client" : "server"; }
  catch { return "server"; }
}

/** Documento virtual de un bloque `<script server>`, con offsets del `.meeko`. */
function createServerBlock(filename: string, source: string, section: SfcSection, options: VirtualComponentOptions): VirtualComponent {
  const spans: SourceSpan[] = [{
    sourceStart: section.contentStart,
    sourceEnd: section.contentEnd,
    generatedStart: 0,
    generatedEnd: section.content.length,
  }];
  // Like a `.route.ts` sidecar, the block is always an ES module. Top-level code gets a
  // `usePage()` typed from its route options, and the request APIs it uses without imports.
  const script = serverScriptOf(source, filename, section);
  const code = script?.body ? serverScriptTypes(section.content, section.contentStart, script, pageRouteId(filename)) : `${section.content}\nexport {};\n`;
  return finishVirtual(filename, serverVirtualFilenameOf(filename), source, code, spans, options, routeBlockTarget(filename, section.content));
}

/**
 * Type-only helpers of models, snippets and `<render>`: the same checks as the compiled
 * component, written inline so the editor does not depend on the package internals. They are
 * declared after the template, where the code shows which ones it needs.
 */
const channelDeclarations = [
  "type __MeekoEquals<A, B> = (<V>() => V extends A ? 1 : 2) extends (<V>() => V extends B ? 1 : 2) ? true : false;",
  "type __MeekoWritable<S> = S extends { readonly value: unknown } ? __MeekoEquals<Pick<S, \"value\">, { -readonly [K in keyof Pick<S, \"value\">]: Pick<S, \"value\">[K] }> extends true ? unknown : { readonly \"a model needs a writable signal; computed and readonly signals cannot be written\": never } : unknown;",
  "declare function __meeko_writable<S>(model: S & __MeekoWritable<S>): void;",
  "type __MeekoNativeModels = { text: string; checkbox: boolean; radio: string | null | undefined; select: string; multiple: string[] };",
  "type __MeekoChannelsOf<M> = M extends { readonly __meekoChannels: infer C } ? C : { readonly models: null; readonly snippets: null };",
  "type __MeekoLoose = { readonly [name: string]: unknown };",
  "type __MeekoTagModels<Models> = [Models] extends [null] ? { readonly [name: string]: \"this component declares no defineModel\" } : Models;",
  "type __MeekoTagSnippets<S> = [S] extends [null] ? { readonly [name: string]: \"this component declares no defineSnippets, so it accepts no children or <snippet>\" } : S;",
  "type __MeekoModelInputs<M> = 0 extends 1 & M ? __MeekoLoose : [M] extends [never] ? __MeekoLoose : __MeekoChannelsOf<M> extends { readonly models: infer Models } ? __MeekoTagModels<Models> : never;",
  "type __MeekoSnippetInputs<M> = 0 extends 1 & M ? __MeekoLoose : [M] extends [never] ? __MeekoLoose : __MeekoChannelsOf<M> extends { readonly snippets: infer S } ? __MeekoTagSnippets<S> : never;",
  // Like `ExtraProps` and `EventNames` of the package: props are exact, except names that start
  // with `on`, which the event names check, so an unknown `on:` is a single error.
  "type __MeekoAnyProp = ((...args: any[]) => unknown) | {} | null | undefined;",
  "type __MeekoExtraProps = { readonly [name: `on${string}`]: __MeekoAnyProp };",
  // Like `TagProps`: an optional prop also accepts `undefined`, which Meeko treats as an absent prop.
  "type __MeekoTagProps<P> = P extends unknown ? { [K in keyof P]: {} extends Record<K, unknown> ? P[K] : {} extends Pick<P, K> ? P[K] | undefined : P[K] } : never;",
  "type __MeekoEventNames<P> = { readonly [K in (P extends unknown ? keyof P : never)]?: unknown };",
  "type __MeekoIsUnion<T, W = T> = T extends unknown ? ([W] extends [T] ? false : true) : never;",
  "type __MeekoPropsOf<M> = [M] extends [{ readonly renderToString: (props: infer P, ...rest: never[]) => unknown }] ? P : __MeekoLoose;",
  "type __MeekoModuleTag<M> = (props: __MeekoTagProps<__MeekoPropsOf<M>> & __MeekoExtraProps, events: NoInfer<__MeekoEventNames<__MeekoPropsOf<M>>>, models: NoInfer<__MeekoModelInputs<M>>, snippets: NoInfer<__MeekoSnippetInputs<M>>) => { readonly typeArguments: {}; readonly props: __MeekoPropsOf<M>; readonly events: {}; readonly models: __MeekoChannelsOf<M> extends { readonly models: infer X } ? X : null; readonly snippets: __MeekoChannelsOf<M> extends { readonly snippets: infer X } ? X : null; readonly exposed: __MeekoExposedOf<M> };",
  "type __MeekoLooseTag = (props: { readonly [name: string]: __MeekoAnyProp }, events: any, models: any, snippets: any) => { readonly typeArguments: {}; readonly exposed: any };",
  // A child module declares its own tag, generic for a generic component; other values get one from their shape.
  "type __MeekoTagOf<M> = 0 extends 1 & M ? __MeekoLooseTag : [M] extends [never] ? __MeekoLooseTag : true extends __MeekoIsUnion<M> ? __MeekoModuleTag<M> : M extends { readonly __meekoTag: infer F } ? F : __MeekoModuleTag<M>;",
  "type __MeekoTagExposed<R> = R extends { readonly exposed: infer E } ? E : unknown;",
  "declare function __meeko_tag<M>(component: M): __MeekoTagOf<M>;",
  "",
].join("\n");

/** `<snippet>` and `<render>` helpers; they use the package's Snippet, so only where the template has them. */
const snippetDeclarations = [
  // The tag call types the parameters through the return type; an unknown snippet gets `any[]`.
  "declare function __meeko_snippet<A extends readonly unknown[] = any[]>(body: NoInfer<(...args: A) => void>): import(\"@meekojs/meeko\").Snippet<A>;",
  "declare function __meeko_render<A extends readonly unknown[]>(snippet: import(\"@meekojs/meeko\").Snippet<A> | undefined, args: NoInfer<A>): void;",
  "",
].join("\n");

/** Native control kind of `model`, like the compiler; `undefined` where model is MEEK065. */
function nativeModelKind(node: TemplateNode): "text" | "checkbox" | "radio" | "select" | "multiple" | undefined {
  const find = (name: string) => node.attrs?.find((attribute) => attribute.name === name);
  if (node.tagName === "input") {
    // `bind:type` makes the control text-like; together with a static `type` it is MEEK065.
    if (find("bind:type")) return find("type") ? undefined : "text";
    const type = (find("type")?.value ?? "text").trim().toLowerCase();
    return type === "checkbox" ? "checkbox" : type === "radio" ? "radio" : "text";
  }
  if (node.tagName === "textarea") return "text";
  if (node.tagName === "select") return find("multiple") ? "multiple" : "select";
  return undefined;
}

/** What the block declares; a block with a Meeko error has no page data in the editor. */
function serverScriptOf(source: string, filename: string, section: SfcSection): ServerScript | undefined {
  try { return analyzeServerScript(source, filename, section); }
  catch (error) { if (error instanceof MeekoCompileError) return undefined; throw error; }
}

/** Une las líneas de un JSDoc de macro. */
function jsdoc(...lines: string[]): string {
  return ["/**", ...lines.map((line) => line ? ` * ${line}` : " *"), " */"].join("\n");
}

const apiDocs = "https://github.com/meekojs/meeko/blob/main/docs/api.md";

/**
 * JSDoc de las macros de compilación. El documento virtual los antepone a sus declaraciones para
 * que el hover, el completado y la ayuda de firma del editor muestren la documentación.
 */
const macroDocs = {
  defineProps: jsdoc(
    "Macro de compilación: declara las props del componente con el tipo `T` y devuelve el objeto de props.",
    "No se importa ni existe en tiempo de ejecución.",
    "",
    "El argumento opcional es un objeto literal de valores por defecto: esas props pasan a ser opcionales",
    "para el padre y, dentro del componente, nunca son `undefined`. Debe aparecer una sola vez, en su",
    "propia declaración (`MEEK016`), y con argumento de tipo (`MEEK017`).",
    "",
    "@example",
    "```html",
    "<script lang=\"ts\">",
    "interface Props { title: string; count?: number }",
    "const props = defineProps<Props>({ count: 0 });",
    "</script>",
    "<template><h2>{props.title} ({props.count})</h2></template>",
    "```",
    `@see ${apiDocs}#valores-por-defecto-en-defineprops`,
  ),
  defineEmits: jsdoc(
    "Macro de compilación: declara los eventos del componente. Cada clave de `T` es un evento y su valor,",
    "la tupla de argumentos. Devuelve `emit(evento, ...args)`, que llama a la prop de callback opcional",
    "`onEvento` que el padre pasa con `on:evento`; sin listener no hace nada.",
    "",
    "Una sola vez, en su propia declaración `const` de nivel superior (`MEEK045`), con argumento de tipo",
    "(`MEEK046`) y sin argumentos en tiempo de ejecución (`MEEK047`).",
    "",
    "@since 1.1.0",
    "@example",
    "```html",
    "<!-- TodoItem.meeko -->",
    "<script lang=\"ts\">",
    "const props = defineProps<{ id: number }>();",
    "const emit = defineEmits<{ save: [id: number]; close: [] }>();",
    "</script>",
    "<template><button on:click=\"() => emit('save', props.id)\">Guardar</button></template>",
    "",
    "<!-- En el padre -->",
    "<TodoItem bind:id=\"todo.id\" on:save=\"(id) => save(id)\" />",
    "```",
    `@see ${apiDocs}#eventos-de-componente-defineemits-y-on`,
  ),
  defineExpose: jsdoc(
    "Macro de compilación: publica `exposed` para el padre que nombra este componente con `ref:` y lo",
    "lee con `useElementRef`. Devuelve el mismo valor. Sin `defineExpose`, el componente expone `null`.",
    "",
    "Es una sentencia de nivel superior que aparece una sola vez (`MEEK050`), con un argumento y como",
    "mucho un argumento de tipo (`MEEK051`). El valor expuesto no viaja en el estado SSR.",
    "",
    "@since 1.1.0",
    "@example",
    "```html",
    "<!-- SearchBox.meeko -->",
    "<script lang=\"ts\">",
    "const query = signal(\"\");",
    "function clear(): void {",
    "  query.value = \"\";",
    "}",
    "defineExpose({ query, clear });",
    "</script>",
    "<template><input bind:value=\"query.value\" on:input=\"(event) => query.value = event.currentTarget.value\"></template>",
    "```",
    `@see ${apiDocs}#exponer-valores-defineexpose`,
  ),
  defineModel: jsdoc(
    "Macro de compilación: declara un modelo, una señal escribible que el padre comparte con",
    "`model=\"señal\"` (el modelo sin nombre) o `model:nombre=\"señal\"`. El hijo lee y escribe la señal del",
    "padre; si el padre no pasa ninguna, usa una señal local creada con `default`. Un modelo sin",
    "`default` es obligatorio para el padre.",
    "",
    "Va en su propia declaración `const` de nivel superior y cada nombre se declara una sola vez (`MEEK063`).",
    "",
    "@since 1.1.0",
    "@example",
    "```html",
    "<!-- Toggle.meeko -->",
    "<script lang=\"ts\">",
    "const open = defineModel<boolean>(\"open\", { default: false });",
    "</script>",
    "<template><button on:click=\"() => open.value = !open.value\">{open.value ? \"Cerrar\" : \"Abrir\"}</button></template>",
    "",
    "<!-- En el padre, con const visible = signal(true) -->",
    "<Toggle model:open=\"visible\" />",
    "```",
  ),
  defineSnippets: jsdoc(
    "Macro de compilación: declara los snippets del componente, contenido de plantilla que el padre",
    "escribe entre las etiquetas del hijo. Cada clave de `T` es un snippet y su valor, la tupla de",
    "parámetros que el hijo le pasa; una clave opcional (`title?: []`) hace opcional el snippet.",
    "",
    "El contenido suelto entre las etiquetas es el snippet `default`; los demás se escriben con",
    "`<snippet name=\"...\" params=\"...\">`. El hijo los coloca con `<render snippet=\"...\" args=\"...\" />`.",
    "El contenido pertenece al padre: lee su ámbito y sus señales. Una sola vez, en su propia",
    "declaración `const` de nivel superior (`MEEK059`).",
    "",
    "@since 1.1.0",
    "@example",
    "```html",
    "<!-- Card.meeko -->",
    "<script lang=\"ts\">",
    "const snippets = defineSnippets<{ default: []; title?: []; actions?: [close: () => void] }>();",
    "const open = signal(true);",
    "</script>",
    "<template>",
    "  <article if:when=\"open.value\">",
    "    <header if:when=\"snippets.title\"><render snippet=\"snippets.title\" /></header>",
    "    <render snippet=\"snippets.default\" />",
    "    <render snippet=\"snippets.actions\" args=\"() => open.value = false\" />",
    "  </article>",
    "</template>",
    "",
    "<!-- En el padre -->",
    "<Card>",
    "  <snippet name=\"title\">Aviso</snippet>",
    "  Texto del cuerpo",
    "  <snippet name=\"actions\" params=\"close\"><button on:click=\"close\">Cerrar</button></snippet>",
    "</Card>",
    "```",
  ),
  useElementRef: jsdoc(
    "Macro de compilación: lee el elemento o el componente que la plantilla nombra con `ref:nombre`.",
    "Su tipo sale de la etiqueta (`HTMLElementTagNameMap` o `SVGElementTagNameMap`) o del `defineExpose`",
    "del componente.",
    "",
    "- Sin `await`, devuelve una señal de sólo lectura que vale `null` en SSR y mientras el destino no existe.",
    "- Con `await`, devuelve el destino, nunca `null`, y el resto del setup continúa sólo en el navegador.",
    "- Dentro de `each:of`, devuelve una señal con la lista de filas, que no admite `await`.",
    "",
    "Sólo en el nivel superior del script (`MEEK054`). El argumento es un literal con el nombre de una",
    "`ref:` de la plantilla (`MEEK056`).",
    "",
    "@since 1.1.0",
    "@example",
    "```html",
    "<script lang=\"ts\">",
    "const title = useElementRef(\"title\");",
    "onMounted(() => {",
    "  title.value?.scrollIntoView();",
    "});",
    "const field = await useElementRef(\"field\");",
    "// Desde aquí, sólo en el navegador y con el campo ya montado.",
    "field.focus();",
    "</script>",
    "<template><h2 ref:title>Buscar</h2><input ref:field /></template>",
    "```",
    `@see ${apiDocs}#referencias-a-elementos-ref-y-useelementref`,
  ),
} as const;

/**
 * Documentación de la directiva `html`, para el hover de su nombre y el JSDoc de su comprobación.
 * Advierte que es insegura con contenido no confiable.
 */
export const htmlDirectiveDocs = [
  "**`html=\"expresión\"`**: el contenido del elemento es el HTML de la expresión, **sin escapar**.",
  "",
  "La expresión es un `string` (o `null`/`undefined`, que dejan el elemento vacío). En SSR se escribe tal cual;",
  "la hidratación no toca el DOM si coincide y sustituye `innerHTML` si difiere o cuando el valor cambia.",
  "",
  "**Inseguro con contenido no confiable**: el HTML de usuarios o terceros puede ejecutar scripts (XSS).",
  "Sanéelo antes o use `{expresión}`, que escapa el texto.",
  "",
  "El elemento no admite hijos y `html` no va en elementos vacíos (`<img>`), de texto (`<textarea>`, `<script>`),",
  "en `<template>` ni junto a `model` (`MEEK095`).",
  "",
  `@see ${apiDocs}#html-sin-escapar-con-html`,
].join("\n");

/** Type check of `html="..."`, declared only where the template has one. */
/** Attributes of a component tag that are no static prop: `is`, `ref` and `html` (MEEK032) and the model `model`. */
const reservedTagAttributes = new Set(["is", "ref", "html", "model"]);

const htmlDeclaration = `${jsdoc(...htmlDirectiveDocs.split("\n"))}\ndeclare function __meeko_html(html: string | null | undefined): void;\n`;

/** Construye el TypeScript virtual que relaciona script y plantilla. */
export function createVirtualComponent(source: string, filename: string, options: VirtualComponentOptions = {}): VirtualComponent {
  const document = parseSfc(source, filename);
  const spans: SourceSpan[] = [];
  let code = document.script.content;
  spans.push({
    sourceStart: document.script.contentStart,
    sourceEnd: document.script.contentEnd,
    generatedStart: 0,
    generatedEnd: code.length,
  });
  const scriptFile = ts.createSourceFile(filename, document.script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // `generic`: `meeko check` reports an invalid list (MEEK100); here it only types the component.
  const genericAttribute = sectionAttribute(source, document.script, "generic");
  let generic: GenericParameters | undefined;
  if (genericAttribute) {
    try { generic = parseGeneric(genericAttribute.value, genericAttribute.offset); }
    catch (error) { if (!(error instanceof GenericError)) throw error; }
  }
  const exposeCall = scriptFile.statements.map((statement) => ts.isExpressionStatement(statement) ? statement.expression : undefined)
    .find((call): call is ts.CallExpression => call !== undefined && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === "defineExpose");
  let defaultKeys: readonly string[] = [];
  let propsTypeText: string | undefined;
  let emitsTypeText: string | undefined;
  let snippetsTypeText: string | undefined;
  /** `defineModel` calls by model name; the compiler reports invalid ones, here the first one wins. */
  const models = new Map<string, { type: string; optional: boolean }>();
  for (const statement of scriptFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
      if (call.expression.text === "defineEmits") emitsTypeText ??= call.typeArguments?.[0]?.getText(scriptFile);
      if (call.expression.text === "defineSnippets") snippetsTypeText ??= call.typeArguments?.[0]?.getText(scriptFile);
      if (call.expression.text === "defineModel") {
        const type = call.typeArguments?.[0]?.getText(scriptFile);
        const [first, second] = call.arguments;
        const named = first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) ? first.text : undefined;
        const options = named === undefined ? first : second;
        const name = named ?? "default";
        if (type && validIdentifier(name) && !models.has(name)) models.set(name, { type, optional: options !== undefined && ts.isObjectLiteralExpression(options) });
      }
      if (call.expression.text !== "defineProps") continue;
      propsTypeText ??= call.typeArguments?.[0]?.getText(scriptFile);
      try { defaultKeys = analyzePropsDefaults(call)?.keys ?? []; }
      catch (error) { if (!(error instanceof PropsDefaultsError)) throw error; }
    }
  }
  if (generic) {
    // The script is module code here, so each type parameter is an alias of its constraint, mapped
    // to the attribute for hover and definition. The module shape below is really generic.
    const mapAt = (value: string, sourceStart: number): void => {
      spans.push({ sourceStart, sourceEnd: sourceStart + value.length, generatedStart: code.length, generatedEnd: code.length + value.length });
      code += value;
    };
    code += "\n";
    for (const parameter of generic.parameters) {
      code += "type ";
      mapAt(parameter.name, parameter.nameOffset);
      code += " = ";
      if (parameter.constraint) mapAt(parameter.constraint.text, parameter.constraint.offset);
      else code += "unknown";
      code += ";\n";
    }
  }
  const defaultKeysType = defaultKeys.map((key) => JSON.stringify(key)).join(" | ");
  const defaultKeysOfProps = `Extract<${defaultKeysType}, keyof T>`;
  const defaultPick = `Pick<T, ${defaultKeysOfProps}>`;
  const resolvedDefaults = `{ [K in keyof ${defaultPick}]-?: Exclude<${defaultPick}[K], undefined> }`;
  const propsReturn = defaultKeysType
    ? `T extends unknown ? Omit<T, ${defaultKeysOfProps}> & ${resolvedDefaults} : never`
    : "T";
  const defaultsParameter = defaultKeysType ? `Partial<T> & ${resolvedDefaults}` : "Partial<T>";
  code += `\n${macroDocs.defineProps}\ndeclare function defineProps<T>(defaults?: ${defaultsParameter}): ${propsReturn};\n`;
  // Same contract as the compiler's `Emit`, inline so the editor does not need the package build.
  code += "type __MeekoEmit<T> = <K extends keyof T & string>(name: K, ...args: T[K] extends readonly unknown[] ? T[K] : never) => void;\n";
  code += `${macroDocs.defineEmits}\ndeclare function defineEmits<T extends { [K in keyof T]: readonly unknown[] }>(): __MeekoEmit<T>;\n`;
  code += `${macroDocs.defineExpose}\ndeclare function defineExpose<T>(exposed: T): T;\n`;
  // defineModel and defineSnippets use the package's Signal and Snippet like the compiled component;
  // they are declared only for a script that uses them, which needs the package anyway.
  const usesModels = /\bdefineModel\b/.test(document.script.content);
  const usesSnippets = /\bdefineSnippets\b/.test(document.script.content);
  if (usesModels) {
    code += `${macroDocs.defineModel}\ndeclare function defineModel<T>(options?: { readonly default: T }): import("@meekojs/meeko").Signal<T>;\n`;
    code += `${macroDocs.defineModel}\ndeclare function defineModel<T>(name: string, options?: { readonly default: T }): import("@meekojs/meeko").Signal<T>;\n`;
  }
  if (usesSnippets) {
    // Distributive, so an optional snippet (`title?: []`) keeps its tuple without `undefined`.
    code += "type __MeekoSnippetParameters<A> = A extends readonly unknown[] ? A : never;\n";
    code += "type __MeekoSnippetMap<T> = { [K in keyof T]: import(\"@meekojs/meeko\").Snippet<__MeekoSnippetParameters<T[K]>> };\n";
    code += `${macroDocs.defineSnippets}\ndeclare function defineSnippets<T extends { [K in keyof T]: readonly unknown[] }>(): __MeekoSnippetMap<T>;\n`;
  }
  // An unmapped copy of the defineExpose call names the exposed type; the script stays verbatim.
  if (exposeCall) code += `const __meeko_exposed = ${exposeCall.getText(scriptFile)};\n`;
  // Exports of the page's top-level server code are plain read-only values in the script and
  // template, typed from the block's own virtual document.
  const serverExports: SourceSpan[] = [];
  const serverScript = document.server ? serverScriptOf(source, filename, document.server) : undefined;
  if (serverScript?.body && serverScript.exports.length) {
    code += `import type * as __meeko_server from ${JSON.stringify(`./${basename(filename)}${serverVirtualSuffix.replace(/\.ts$/, ".js")}`)};\n`;
    for (const binding of serverScript.exports) {
      code += "declare const ";
      serverExports.push({ sourceStart: binding.start, sourceEnd: binding.end, generatedStart: code.length, generatedEnd: code.length + binding.name.length });
      code += `${binding.name}: import("@meekojs/meeko/framework").ServerData<Awaited<typeof __meeko_server.${binding.name}>>;\n`;
    }
  }
  code += "function __meeko_template() {\n";
  const componentTags: ComponentTag[] = [];
  const componentEvents: Array<{ start: number; end: number }> = [];
  const componentModels: Array<{ start: number; end: number }> = [];
  const snippetTags: SnippetTag[] = [];
  const htmlDirectives: Array<{ start: number; end: number }> = [];
  /** `ref:name` directives, typed like the compiler types `useElementRef("name")`. */
  const refs = new Map<string, { type: string; list: boolean }>();
  let listDepth = 0;
  let snippetDepth = 0;
  /** Copias sin mapear de la comprobación de etiqueta de cada ref a componente fuera de listas, para su tipo expuesto. */
  const refHelpers: string[] = [];
  /**
   * Condiciones `if:when` alrededor del nodo visitado, con los nombres que leen. Su contenido va en
   * un `if` que estrecha los tipos, como hace el compilador para `meeko check`; un snippet es una
   * función propia y las repite, sin mapear, salvo las que sus parámetros ocultan.
   */
  const guards: Array<{ readonly text: string; readonly names: ReadonlySet<string> }> = [];
  /** Abre un `if` sin mapear con las condiciones que siguen valiendo donde `shadowing` oculta nombres. */
  const reguard = (shadowing: readonly string[]): boolean => {
    const active = guards.filter((guard) => !shadowing.some((name) => guard.names.has(name)));
    if (!active.length) return false;
    code += `if (${active.map((guard) => `!!(${guard.text})`).join(" && ")}) {\n`;
    return true;
  };

  /** Atributo de una etiqueta de componente que es una prop estática: `variant="primary"` o `disabled`. */
  const staticProp = (rawName: string): boolean => validIdentifier(rawName) && !reservedTagAttributes.has(rawName);

  /** Props de una etiqueta de componente, como las fijan `bind:x`, `on:x` y `x="texto"`: `{ x: (...), onX: (...) }`. */
  const tagProps = (attrs: NonNullable<TemplateNode["attrs"]>): string => {
    const entries: string[] = [];
    for (const attribute of attrs) {
      const rawName = /^[^\s=]+/.exec(source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name;
      if (staticProp(rawName)) {
        entries.push(`${rawName}: ${attributeValueStart(source, attribute) === undefined ? "true" : JSON.stringify(attribute.value)}`);
        continue;
      }
      const name = rawName.startsWith("bind:") ? rawName.slice(5) : rawName.startsWith("on:") && rawName.length > 3 ? `on${rawName.charAt(3).toUpperCase()}${rawName.slice(4)}` : undefined;
      if (name === undefined || !validIdentifier(name)) continue;
      entries.push(`${name}: ${attribute.value.trim() ? `(${attribute.value})` : "undefined"}`);
    }
    return `{ ${entries.join(", ")} }`;
  };

  /** Agrega una expresión conservando su posición original. */
  const expression = (value: string, sourceStart: number): void => {
    code += "void (";
    const generatedStart = code.length;
    code += value;
    spans.push({ sourceStart, sourceEnd: sourceStart + value.length, generatedStart, generatedEnd: code.length });
    code += ");\n";
  };

  const mapped = (value: string, sourceStart: number): void => {
    const generatedStart = code.length;
    code += value;
    spans.push({ sourceStart, sourceEnd: sourceStart + value.length, generatedStart, generatedEnd: code.length });
  };

  const root = parseTemplate(source, document.template, filename);

  /** Recorre la plantilla y conserva el ámbito de cada lista. */
  const visit = (node: TemplateNode): void => {
    const attrs = node.attrs ?? [];
    let childrenVisited = false;
    // `if:when` narrows the bindings and the children of its element, like `v-if` in Vue.
    const condition = attrs.find((attr) => attr.name === "if:when");
    const conditionStart = condition ? attributeValueStart(source, condition) : undefined;
    const narrows = condition !== undefined && conditionStart !== undefined && condition.value.trim() !== "";
    if (narrows) {
      code += "if (!!(";
      mapped(condition.value, conditionStart);
      code += ")) {\n";
      guards.push({ text: condition.value, names: new Set(freeIdentifiers(condition.value).map(({ name }) => name)) });
    }
    const list = attrs.find((attr) => attr.name === "each:of");
    const refDirective = attrs.find((attr) => attr.name.startsWith("ref:"));
    if (refDirective) {
      const name = /^[^\s=]+/.exec(source.slice(refDirective.start, refDirective.end))?.[0].slice(4) ?? "";
      const reference = node.componentName ?? (node.tagName === "component" ? attrs.find((attr) => attr.name === "is")?.value.trim() : undefined);
      const listed = listDepth > 0 || list !== undefined;
      let type: string;
      if (reference !== undefined && !listed && snippetDepth === 0 && reference.trim()) {
        // Like the compiled component, the exposed value comes from the tag check and its props.
        const helper = `__meeko_ref_${refHelpers.length}`;
        refHelpers.push(`const ${helper} = () => __meeko_tag((${reference}))(${tagProps(attrs)}, null!, null!, null!);\n`);
        type = `__MeekoTagExposed<ReturnType<typeof ${helper}>>`;
      } else type = reference !== undefined
        ? (/^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*$/.test(reference) ? `__MeekoExposedOf<typeof ${reference}>` : "unknown")
        : `__MeekoElementOf<${JSON.stringify(node.tagName ?? "")}, ${node.namespaceURI === "http://www.w3.org/2000/svg"}>`;
      if (validIdentifier(name) && !refs.has(name)) refs.set(name, { type, list: listed });
    }
    if (list) listDepth++;
    const item = attrs.find((attr) => attr.name === "each:as")?.value ?? "item";
    const index = attrs.find((attr) => attr.name === "each:index")?.value ?? "index";
    // A row's item and index shadow outer names: snippets inside the row do not repeat those conditions.
    const outerGuards = list ? guards.splice(0, guards.length) : undefined;
    if (outerGuards) guards.push(...outerGuards.filter((guard) => !guard.names.has(item) && !guard.names.has(index)));
    if (list) {
      const listStart = attributeValueStart(source, list);
      code += `for (const ${validIdentifier(item) ? item : "item"} of (`;
      const generatedStart = code.length;
      code += list.value;
      if (listStart !== undefined) spans.push({
        sourceStart: listStart,
        sourceEnd: listStart + list.value.length,
        generatedStart,
        generatedEnd: code.length,
      });
      code += `)) {\nconst ${validIdentifier(index) ? index : "index"}: number = 0;\n`;
    }

    // `<AppButton>` is `<component is="AppButton">` with the tag naming a script identifier.
    const componentName = node.componentName;
    const reference = componentName === undefined && node.tagName === "component" ? attrs.find((attr) => attr.name === "is") : undefined;
    if (componentName !== undefined || reference) {
      const value = componentName ?? reference!.value;
      const valueStart = componentName !== undefined ? node.start + 1 : attributeValueStart(source, reference!) ?? reference!.start;
      if (componentName !== undefined) {
        const endTag = node.selfClosing ? undefined : node.sourceCodeLocation?.endTag;
        componentTags.push({
          name: componentName,
          start: valueStart,
          ...(endTag ? { closeStart: document.template.contentStart + endTag.startOffset + 2 } : {}),
        });
      }
      // One tag call, like the compiled component: a generic child infers its type parameters from
      // the props, and they type the handlers, the models and the snippets.
      code += "__meeko_tag((";
      mapped(value, valueStart);
      code += "))(";
      mapped("{", valueStart);
      code += " ";
      for (const attribute of attrs) {
        const rawName = /^[^\s=]+/.exec(source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name;
        if (rawName.startsWith("bind:")) mapped(rawName.slice(5), attribute.start + 5);
        else if (rawName.startsWith("on:") && rawName.length > 3) {
          // `on:save` sets the callback prop `onSave`; the event name keeps its own span.
          const event = rawName.slice(3);
          mapped("on", attribute.start);
          mapped(`${event.charAt(0).toUpperCase()}${event.slice(1)}`, attribute.start + 3);
          componentEvents.push({ start: attribute.start + 3, end: attribute.start + rawName.length });
        } else if (staticProp(rawName)) {
          // `variant="primary"` is a string literal prop; a bare `disabled` passes `true`.
          mapped(rawName, attribute.start);
          code += ": ";
          const valueStart = attributeValueStart(source, attribute);
          // The name already maps to the attribute; `true` has no source text of its own.
          if (valueStart === undefined) code += "true";
          else {
            const quoted = /["']/.test(source[valueStart - 1] ?? "");
            mapped(JSON.stringify(attribute.value), quoted ? valueStart - 1 : valueStart);
          }
          code += ", ";
          continue;
        } else continue;
        code += ": ";
        if (attribute.value.trim()) mapped(attribute.value, attributeValueStart(source, attribute) ?? attribute.start);
        else code += "undefined";
        code += ", ";
      }
      // The names that start with `on`, as `on:event` sets them: one the child does not declare is
      // an excess property there. The props accept them, so an unknown one is a single error.
      code += "}, { ";
      for (const attribute of attrs) {
        const rawName = /^[^\s=]+/.exec(source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name;
        if (rawName.startsWith("on:") && rawName.length > 3) {
          const event = rawName.slice(3);
          mapped("on", attribute.start);
          mapped(`${event.charAt(0).toUpperCase()}${event.slice(1)}`, attribute.start + 3);
        } else if (rawName.startsWith("bind:on") && validIdentifier(rawName.slice(5))) mapped(rawName.slice(5), attribute.start + 5);
        else if (rawName.startsWith("on") && staticProp(rawName)) mapped(rawName, attribute.start);
        else continue;
        code += ": true, ";
      }
      code += "}, ";
      visitModels(attrs);
      code += ", ";
      // Children of `<AppDialog>` are snippets; `<component is>` rejects children (MEEK031).
      if (componentName !== undefined) {
        visitSnippets(node);
        childrenVisited = true;
      } else code += "{}";
      code += ");\n";
      for (const attribute of attrs) {
        const rawName = /^[^\s=]+/.exec(source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name;
        if ((rawName !== "model" && !rawName.startsWith("model:")) || !attribute.value.trim()) continue;
        code += "__meeko_writable(";
        mapped(attribute.value, attributeValueStart(source, attribute) ?? attribute.start);
        code += ");\n";
      }
      // After the tag call, whose mapping of the name comes first for hover and definition.
      code += "void ((";
      mapped(value, valueStart);
      code += ") satisfies import(\"@meekojs/meeko\").Component<never>);\n";
    } else if (node.tagName === "render") {
      // `<render snippet="snippets.x" args="a, b" />`: the arguments must match the snippet.
      const snippet = attrs.find((attr) => attr.name === "snippet");
      const snippetStart = snippet ? attributeValueStart(source, snippet) : undefined;
      if (snippet?.value.trim() && snippetStart !== undefined) {
        code += "__meeko_render((";
        mapped(snippet.value, snippetStart);
        code += "), [";
        const args = attrs.find((attr) => attr.name === "args");
        const argsStart = args ? attributeValueStart(source, args) : undefined;
        if (args?.value.trim() && argsStart !== undefined) mapped(args.value, argsStart);
        code += "]);\n";
      }
    } else {
      // On a custom element (`<x-markdown html="intro">`), `html` and `model` are plain HTML
      // attributes, as in the compiler: their value is text, not an expression.
      const directives = node.tagName !== undefined && !isCustomElementTag(node.tagName);
      // `model="signal"` on a form control: the signal type of the control, and writable.
      const model = directives ? attrs.find((attr) => attr.name === "model") : undefined;
      const modelStart = model ? attributeValueStart(source, model) : undefined;
      const kind = nativeModelKind(node);
      if (model?.value.trim() && modelStart !== undefined && kind) {
        code += `void ((): { value: __MeekoNativeModels[${JSON.stringify(kind)}] } => (`;
        mapped(model.value, modelStart);
        code += "));\n__meeko_writable(";
        mapped(model.value, modelStart);
        code += ");\n";
      }
      // `html="expression"`: unescaped HTML, typed `string | null | undefined`.
      const html = directives ? attrs.find((attr) => attr.name === "html") : undefined;
      if (html) {
        htmlDirectives.push({ start: html.start, end: html.start + "html".length });
        const htmlStart = attributeValueStart(source, html);
        if (html.value.trim() && htmlStart !== undefined) {
          code += "__meeko_html(";
          mapped(html.value, htmlStart);
          code += ");\n";
        }
      }
      for (const attr of attrs) {
        if (!/^(?:bind|on|if|each):/.test(attr.name) && !(node.tagName === "component" && attr.name === "is")) continue;
        if (["each:of", "each:as", "each:index"].includes(attr.name)) continue;
        if (attr === condition && narrows) continue;
        const start = attributeValueStart(source, attr);
        if (start === undefined) continue;
        if (attr.name.startsWith("on:")) {
          const eventType = templateEventType("__Meeko", attr.name.slice(3), node.tagName ?? "", node.namespaceURI === "http://www.w3.org/2000/svg");
          code += `void (((__meeko_handler: (event: ${eventType}) => unknown) => __meeko_handler)(`;
          mapped(attr.value, start);
          code += "));\n";
        } else if (attr.name === "each:key") {
          code += "void (((__meeko_key: string | number) => __meeko_key)(";
          mapped(attr.value, start);
          code += "));\n";
        } else expression(attr.value, start);
      }
    }

    if (node.nodeName === "#text") {
      // El CLI informa de interpolaciones vacías o sin cerrar; aquí sólo se modelan las válidas.
      for (const segment of scanInterpolations(source.slice(node.start, node.end)).segments) {
        if (segment.expression) expression(decodeTemplateText(segment.expression), node.start + segment.expressionStart);
      }
    }
    if (!childrenVisited) for (const child of node.childNodes ?? []) visit(child);
    for (const child of node.content?.childNodes ?? []) visit(child);
    if (list) { code += "}\n"; listDepth--; }
    if (outerGuards) guards.splice(0, guards.length, ...outerGuards);
    if (narrows) {
      code += "}\n";
      guards.pop();
    }
  };

  /** `model` y `model:nombre` de una etiqueta de componente: el argumento de modelos de su comprobación. */
  const visitModels = (attrs: NonNullable<TemplateNode["attrs"]>): void => {
    const models = attrs.map((attribute) => ({ attribute, rawName: /^[^\s=]+/.exec(source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name }))
      .filter(({ rawName }) => rawName === "model" || rawName.startsWith("model:"));
    code += "{ ";
    for (const { attribute, rawName } of models) {
      if (rawName === "model") code += "\"default\"";
      else {
        // The name after `model:` keeps its span for completion and hover.
        const name = rawName.slice(6);
        componentModels.push({ start: attribute.start + 6, end: attribute.start + rawName.length });
        if (validIdentifier(name)) mapped(name, attribute.start + 6);
        else if (!name) {
          mapped("", attribute.start + 6);
          code += "__meeko_model";
        } else code += JSON.stringify(name);
      }
      code += ": ";
      if (attribute.value.trim()) mapped(attribute.value, attributeValueStart(source, attribute) ?? attribute.start);
      else code += "undefined";
      code += ", ";
    }
    code += "}";
  };

  /**
   * Children of a component tag: loose content fills `default` and each `<snippet name params>`
   * fills its snippet, as a function whose parameters the child's defineSnippets types.
   */
  const visitSnippets = (node: TemplateNode): void => {
    const children = node.childNodes ?? [];
    const loose = children.filter((child) => child.tagName !== "snippet");
    snippetDepth++;
    code += "{ ";
    if (loose.some((child) => child.nodeName !== "#comment" && (child.nodeName !== "#text" || Boolean(child.value?.trim())))) {
      code += "\"default\": __meeko_snippet(() => {\n";
      const guarded = reguard([]);
      for (const child of loose) visit(child);
      code += guarded ? "}\n}),\n" : "}),\n";
    }
    for (const child of children) {
      if (child.tagName !== "snippet") continue;
      const attrs = child.attrs ?? [];
      const nameAttribute = attrs.find((attr) => attr.name === "name");
      const paramsAttribute = attrs.find((attr) => attr.name === "params");
      const name = nameAttribute?.value ?? "";
      const nameStart = nameAttribute ? attributeValueStart(source, nameAttribute) : undefined;
      const paramsStart = paramsAttribute ? attributeValueStart(source, paramsAttribute) : undefined;
      // The name is a key of the snippets argument, mapped for completion and hover.
      if (nameStart !== undefined && validIdentifier(name)) mapped(name, nameStart);
      else if (nameStart !== undefined && !name) {
        mapped("", nameStart);
        code += "__meeko_snippet_name";
      } else code += JSON.stringify(name);
      code += ": __meeko_snippet((";
      // Only a list of identifiers is mapped; anything else is MEEK061 in the compiler.
      if (paramsAttribute && paramsStart !== undefined && /^\s*(?:[A-Za-z_$][\w$]*\s*(?:,\s*[A-Za-z_$][\w$]*\s*)*)?$/.test(paramsAttribute.value)) {
        mapped(paramsAttribute.value, paramsStart);
      }
      code += ") => {\n";
      const guarded = reguard((paramsAttribute?.value ?? "").split(",").map((param) => param.trim()).filter(Boolean));
      for (const grandchild of child.childNodes ?? []) visit(grandchild);
      code += guarded ? "}\n}),\n" : "}),\n";
      if (nameStart !== undefined) {
        snippetTags.push({
          nameStart,
          nameEnd: nameStart + name.length,
          ...(paramsStart !== undefined && paramsAttribute ? { paramsStart, paramsEnd: paramsStart + paramsAttribute.value.length } : {}),
        });
      }
    }
    code += "}";
    snippetDepth--;
  };
  for (const node of root.childNodes ?? []) visit(node);
  code += "}\n";
  code += refHelpers.join("");
  code += channelDeclarations;
  if (code.includes("__meeko_snippet(") || code.includes("__meeko_render(")) code += snippetDeclarations;
  if (code.includes("__meeko_html(")) code += htmlDeclaration;
  if (code.includes("__MeekoEventOf<")) code += `${templateEventDeclaration}\n`;
  // `useElementRef` is a compiler macro typed from the template, like the compiled component.
  code += "type __MeekoExposedOf<M> = M extends { readonly hydrateScope: (...args: never[]) => infer R } ? R extends { readonly exposed?: infer E } ? (unknown extends E ? null : E) : null : null;\n";
  code += "type __MeekoElementOf<Tag extends string, Svg extends boolean> = Svg extends true ? Tag extends keyof SVGElementTagNameMap ? SVGElementTagNameMap[Tag] : SVGElement : Tag extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[Tag] : HTMLElement;\n";
  code += `type __MeekoRefs = { ${[...refs].map(([name, ref]) => `${JSON.stringify(name)}: ${ref.type}`).join("; ")} };\n`;
  code += `type __MeekoListRefs = ${[...refs].filter(([, ref]) => ref.list).map(([name]) => JSON.stringify(name)).join(" | ") || "never"};\n`;
  // A component without defineExpose has nothing to await: its `then` is not a promise's (MEEK080).
  code += "type __MeekoUnexposedRef = { readonly value: null; then(meek080: \"MEEK080: esta ref nombra un componente sin defineExpose, así que no expone nada que esperar; añade defineExpose al componente o lee .value\"): never };\n";
  code += `${macroDocs.useElementRef}\n`;
  code += "declare function useElementRef<K extends keyof __MeekoRefs>(name: K): K extends __MeekoListRefs ? { readonly value: readonly __MeekoRefs[K][] } : [__MeekoRefs[K]] extends [null] ? __MeekoUnexposedRef : { readonly value: __MeekoRefs[K] | null } & PromiseLike<__MeekoRefs[K]>;\n";
  // The module shape of the compiled component, so another component that imports this one
  // in the shared editor project sees its props, including the `onEvent` callbacks.
  const declaredProps = propsTypeText ?? "Record<string, never>";
  // A generic component declares its parameters on each type (G) and passes them on (A).
  const G = generic ? `<${generic.declaration}>` : "";
  const A = generic ? `<${generic.names.join(", ")}>` : "";
  const K = generic ? "__K" : "K";
  const inputProps = defaultKeysType
    ? `__MeekoDeclaredProps${A} extends unknown ? Omit<__MeekoDeclaredProps${A}, Extract<${defaultKeysType}, keyof __MeekoDeclaredProps${A}>> & { [${K} in Extract<${defaultKeysType}, keyof __MeekoDeclaredProps${A}>]?: __MeekoDeclaredProps${A}[${K}] | undefined } : never`
    : `__MeekoDeclaredProps${A}`;
  code += `type __MeekoDeclaredProps${G} = ${declaredProps};\n`;
  // Named so the editor can list the events of this component on a parent's tag.
  if (emitsTypeText) code += `type __MeekoEmits${G} = ${emitsTypeText};\n`;
  code += "type __MeekoEmitPropsOf<T> = { [K in keyof T & string as `on${Capitalize<K>}`]?: ((...args: T[K] extends readonly unknown[] ? T[K] : never) => void) | undefined };\n";
  code += `export type ComponentProps${G} = (${inputProps})${emitsTypeText ? ` & __MeekoEmitPropsOf<__MeekoEmits${A}>` : ""};\n`;
  // Structural, without importing the package: it satisfies `Component<ComponentProps>`.
  code += `export declare function renderToString${G}(props: ComponentProps${A}, state?: Record<string, unknown>): string;\n`;
  code += `export declare function renderWithState${G}(props: ComponentProps${A}): { html: string; state: Record<string, unknown> };\n`;
  if (generic && exposeCall) {
    // The script above sees each parameter as its constraint; a typed copy inside a generic
    // function gives the exposed value of each instantiation. It is never called.
    const body = scriptFile.statements.flatMap((statement) => {
      if (ts.isImportDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isExportDeclaration(statement)) return [];
      if (ts.isExpressionStatement(statement) && statement.expression === exposeCall) return [`const __meeko_generic_exposed = ${exposeCall.getText(scriptFile)};`];
      return [statement.getText(scriptFile)];
    });
    code += `async function __meeko_generic_setup${G}() {\n${body.join("\n")}\nreturn __meeko_generic_exposed;\n}\n`;
  }
  // Like `ExposedOf` in the package: a parent ref to this component receives this value.
  code += `export type ComponentExposed${G} = ${exposeCall ? generic ? `Awaited<ReturnType<typeof __meeko_generic_setup${A}>>` : "typeof __meeko_exposed" : "null"};\n`;
  // Models and snippets are channels of their own, beside the props, like the compiled component.
  code += `export type ComponentModels${G} = ${models.size
    ? `{ ${[...models].map(([name, model]) => `${JSON.stringify(name)}${model.optional ? "?" : ""}: import("@meekojs/meeko").Signal<${model.type}>`).join("; ")} }`
    : "null"};\n`;
  code += `export type ComponentSnippets${G} = ${snippetsTypeText && usesSnippets ? `__MeekoSnippetMap<${snippetsTypeText}>` : "null"};\n`;
  code += generic
    ? `declare function __meeko_channels${G}(): { readonly models: ComponentModels${A}; readonly snippets: ComponentSnippets${A} };\nexport declare const __meekoChannels: ReturnType<typeof __meeko_channels>;\n`
    : "export declare const __meekoChannels: { readonly models: ComponentModels; readonly snippets: ComponentSnippets };\n";
  // The check of a parent's tag, like the compiled component's: the parameters come from the props
  // alone. Its result lets the editor show the child with them resolved.
  const typeArguments = generic ? generic.names.map((name) => `${name}: ${name}`).join("; ") : "";
  code += `export declare const __meekoTag: ${G}(props: __MeekoTagProps<ComponentProps${A}> & __MeekoExtraProps, events: NoInfer<__MeekoEventNames<ComponentProps${A}>>, models: NoInfer<__MeekoTagModels<ComponentModels${A}>>, snippets: NoInfer<__MeekoTagSnippets<ComponentSnippets${A}>>) => { readonly typeArguments: { ${typeArguments} }; readonly props: ComponentProps${A}; readonly events: ${emitsTypeText ? `__MeekoEmits${A}` : "{}"}; readonly models: ComponentModels${A}; readonly snippets: ComponentSnippets${A}; readonly exposed: ComponentExposed${A} };\n`;
  code += `export declare function hydrateScope${G}(scope: object, props: ComponentProps${A}, state?: Record<string, unknown>): { (): void; readonly exposed?: ComponentExposed${A} };\n`;
  code += `export declare function hydrate${G}(root: object, props: ComponentProps${A}, state?: Record<string, unknown>): () => void;\n`;
  code += "export declare const css: string;\n";
  // Every component is an ES module, like the compiler output; this keeps the
  // declarations of components that share a TypeScript project isolated.
  code += "export {};\n";

  const target = resolve(filename).replaceAll("\\", "/").includes("/server/") ? "server" : "client";
  const registry = options.registry ?? discoverAutoImportsSync(projectRoot(filename));
  const resolved = { ...options, registry };
  const files = componentTags.length ? componentFiles(scriptFile, filename, registry) : new Map<string, string>();
  const component: VirtualComponent = {
    ...finishVirtual(filename, virtualFilenameOf(filename), source, code, spans, resolved, target, serverExports),
    ...(serverExports.length ? { serverExports } : {}),
    componentTags: componentTags.map((tag) => files.has(tag.name) ? { ...tag, file: files.get(tag.name)! } : tag),
    componentEvents,
    componentModels,
    snippetTags,
    ...(document.script.implicit ? { implicitScript: true as const } : {}),
    ...(htmlDirectives.length ? { htmlDirectives } : {}),
  };
  return document.server ? { ...component, server: createServerBlock(filename, source, document.server, resolved) } : component;
}

/** `.meeko` de cada nombre de componente: el import explícito del script o, si no, su autoimport. */
export function componentFiles(script: ts.SourceFile, filename: string, registry: readonly AutoImport[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of registry) {
    if (!entry.component) continue;
    // An ambiguous name has no single target.
    if (registry.some((other) => other !== entry && other.name === entry.name)) continue;
    files.set(entry.name, entry.file);
  }
  for (const statement of script.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    const names = [clause?.name?.text, clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? clause.namedBindings.name.text : undefined];
    for (const name of names) {
      if (!name) continue;
      if (specifier.startsWith(".") && specifier.endsWith(".meeko")) files.set(name, resolve(dirname(filename), specifier));
      else files.delete(name);
    }
  }
  return files;
}

/** Aplica los autoimports al código virtual y construye su mapa de posiciones. */
function finishVirtual(
  filename: string,
  virtualFilename: string,
  source: string,
  generated: string,
  spans: SourceSpan[],
  options: VirtualComponentOptions,
  target: "client" | "server",
  /** Spans outside the position map that also move with the autoimport prefix. */
  extra: readonly SourceSpan[] = [],
): VirtualComponent {
  let code = generated;
  let registry = options.registry ?? discoverAutoImportsSync(projectRoot(filename));
  const problems: AutoImportProblem[] = [];
  let transformed: string | undefined;
  while (transformed === undefined) {
    try {
      transformed = applyAutoImports(code, virtualFilename, registry, target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const match = /^(?:Autoimport ambiguo (\S+?):|El autoimport (\S+) no está disponible)/.exec(message);
      const name = match?.[1] ?? match?.[2];
      if (!options.tolerant || !name || !registry.some((entry) => entry.name === name)) throw error;
      problems.push({
        name,
        kind: match?.[1] ? "ambiguous" : "unavailable",
        message,
        candidates: registry.filter((entry) => entry.name === name),
      });
      registry = registry.filter((entry) => entry.name !== name);
    }
  }
  const prefixLength = transformed.length - code.length;
  if (prefixLength) {
    for (const span of [...spans, ...extra]) {
      span.generatedStart += prefixLength;
      span.generatedEnd += prefixLength;
    }
    code = transformed;
  }
  const map = (offset: number, direction: "source" | "generated"): number | undefined => {
    for (const span of spans) {
      const from = direction === "source" ? span.sourceStart : span.generatedStart;
      const to = direction === "source" ? span.generatedStart : span.sourceStart;
      const end = direction === "source" ? span.sourceEnd : span.generatedEnd;
      if (offset >= from && offset <= end) return to + offset - from;
    }
    return undefined;
  };
  return {
    filename,
    virtualFilename,
    source,
    code,
    spans,
    problems,
    toGenerated: (offset) => map(offset, "source"),
    toSource: (offset) => map(offset, "generated"),
  };
}

/** Opciones que comprueba `meeko check`; se usan si el proyecto no tiene tsconfig.json. */
export function defaultCompilerOptions(root: string): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true,
    skipLibCheck: true,
    noEmit: true,
    rootDirs: [root, resolve(root, ".meeko/types")],
    allowArbitraryExtensions: true,
  };
}

const emitOptions = [
  "outDir", "outFile", "rootDir", "declaration", "declarationDir", "declarationMap", "emitDeclarationOnly",
  "composite", "incremental", "tsBuildInfoFile", "sourceMap", "inlineSourceMap", "inlineSources", "noEmitOnError",
] as const;

/**
 * Lee el tsconfig.json de la raíz del proyecto. El editor conserva sus opciones de tipos
 * (paths, lib, types, strict...) y sólo fuerza lo necesario para analizar componentes:
 * sin emisión, extensiones arbitrarias y `rootDirs` sobre `.meeko/types`.
 */
export function resolveProjectCompilerOptions(root: string): ProjectCompilerOptions {
  const directory = resolve(root);
  const configFile = join(directory, "tsconfig.json");
  if (!existsSync(configFile)) return { options: defaultCompilerOptions(directory), fileNames: [] };
  let failed = false;
  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => { failed = true; },
  });
  if (!parsed || failed) return { options: defaultCompilerOptions(directory), fileNames: [], configFile };
  const options: ts.CompilerOptions = { ...parsed.options };
  for (const key of emitOptions) delete options[key];
  options.noEmit = true;
  options.allowArbitraryExtensions = true;
  const rootDirs = [...(options.rootDirs ?? [])];
  for (const entry of [directory, resolve(directory, ".meeko/types")]) {
    if (!rootDirs.some((existing) => resolve(existing).toLowerCase() === entry.toLowerCase())) rootDirs.push(entry);
  }
  options.rootDirs = rootDirs;
  const fileNames = parsed.fileNames.filter((file) => /\.(?:[cm]?ts|tsx)$/.test(file) && !file.endsWith(".meeko.ts") && !file.endsWith(`.meeko${serverVirtualSuffix}`));
  return { options, fileNames, configFile };
}

/** Versión de un archivo en disco para que TypeScript detecte cambios guardados. */
export function diskVersion(file: string): string {
  try {
    const stat = statSync(file);
    return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  } catch { return "missing"; }
}

/** Construye un proyecto TypeScript virtual de un solo componente. */
export function createEditorModel(source: string, filename: string, options: EditorModelOptions = {}): EditorModel {
  const component = createVirtualComponent(source, filename, options);
  const virtual = new Map<string, string>([[component.virtualFilename, component.code]]);
  if (component.server) virtual.set(component.server.virtualFilename, component.server.code);
  const compilerOptions = options.compilerOptions ?? resolveProjectCompilerOptions(projectRoot(filename)).options;
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [...virtual.keys()],
    getScriptVersion: (file) => virtual.has(file) ? "1" : diskVersion(file),
    getScriptSnapshot: (file) => {
      const content = virtual.get(file) ?? ts.sys.readFile(file);
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => dirname(filename),
    getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
    fileExists: (file) => virtual.has(file) || ts.sys.fileExists(file),
    readFile: (file) => virtual.get(file) ?? ts.sys.readFile(file),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: (file) => ts.sys.realpath?.(file) ?? file,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => ts.sys.newLine,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  return { ...component, service, dispose: () => service.dispose() };
}

function validIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}
