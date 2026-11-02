import ts from "@typescript/typescript6";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import type { AutoImport } from "../autoimports/registry";
import type { GenericParameters } from "../compiler/generic";
import type { SfcSection } from "../compiler/parser/sfc";
import type { DecodedExpressionPiece, TemplateNode } from "../compiler/parser/template";
import type { IsLeaf } from "../compiler/transforms/dynamic-tag";
import type { ServerScript } from "../compiler/transforms/server-script";
import type { ProjectAliases } from "../framework/aliases";
import type { BuiltinTag } from "./builtin-tags";

import { apiDocs, jsdoc } from "../app/definitions/compiler-docs";
import { defineEmitsDocs } from "../app/definitions/define-emits";
import { defineExposeDocs } from "../app/definitions/define-expose";
import { defineModelDocs } from "../app/definitions/define-model";
import { definePropsDocs } from "../app/definitions/define-props";
import { analyzePropsDefaults, componentDefaultsType, propsDefaultLiteralTypes, PropsDefaultsError, propsDefaultTexts } from "../app/definitions/define-props";
import { defineSnippetsDocs } from "../app/definitions/define-snippets";
import { useElementRefDocs, useElementRefEditorDeclaration, useElementRefUnexposedEditorType } from "../app/definitions/use-element-ref";
import { discoverAutoImportsSync } from "../autoimports/registry";
import { applyAutoImports, autoImportedValues } from "../autoimports/transform";
import { awaitForReferences, shadowedBuiltinTags } from "../compiler";
import { aliasCandidates, aliasTsconfigPaths } from "../compiler/aliases";
import { defaultLiteralType } from "../compiler/codegen/props";
import { pageRouteId, serverScriptTypes } from "../compiler/codegen/server-script";
import { freeIdentifiers } from "../compiler/composables";
import { GenericError, parseGeneric, sectionAttribute } from "../compiler/generic";
import { scanInterpolations } from "../compiler/parser/interpolation";
import { MeekoCompileError, parseSfc } from "../compiler/parser/sfc";
import { attributeValueStart, decodeTemplateExpression, isCustomElementTag, parseTemplate } from "../compiler/parser/template";
import { generatedServicesDeclaration, projectDeclarationFiles } from "../compiler/project-declarations";
import { projectRoot } from "../compiler/project-root";
import { branchTakes, isBranchCondition, isCandidates, isComponentName, isLeaves, scriptValueNames } from "../compiler/transforms/dynamic-tag";
import { templateEventDeclaration, templateEventType } from "../compiler/transforms/events";
import { analyzeServerScript } from "../compiler/transforms/server-script";
import { aliasesForScope, resolveProjectAliasesSync } from "../framework/aliases";
import { extractRouteRender } from "../framework/routes-discovery";
import { builtinTag, builtinTagProp } from "./builtin-tags";

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
  /**
   * Etiqueta propia de Meeko (`MeekoLink`, `MeekoOutlet`…) que no sustituye un componente del
   * proyecto, con el alias del código virtual que tipa sus props.
   */
  readonly builtin?: { readonly name: string; readonly alias: string };
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
  "type __MeekoNativeModels = { text: string; range: number | string; checkbox: boolean | undefined; radio: string | null | undefined; select: string; multiple: string[] };",
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
function nativeModelKind(node: TemplateNode): "text" | "range" | "checkbox" | "radio" | "select" | "multiple" | undefined {
  const find = (name: string) => node.attrs?.find((attribute) => attribute.name === name);
  if (node.tagName === "input") {
    // `bind:type` makes the control text-like; together with a static `type` it is MEEK065.
    if (find("bind:type")) return find("type") ? undefined : "text";
    const type = (find("type")?.value ?? "text").trim().toLowerCase();
    return type === "checkbox" ? "checkbox" : type === "radio" ? "radio" : type === "range" ? "range" : "text";
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

/**
 * JSDoc of `<MeekoThemeToggle>`. The virtual document declares it as the compiled component that
 * Meeko ships, so its props, its snippets and its hover come from that module, as for any tag.
 */
const themeToggleDocs = jsdoc(
  "Etiqueta propia de Meeko (desde 1.4, con `theme` en `meeko.config.ts`): cambia el tema claro/oscuro.",
  "Pinta un icono por elección en `<span data-meeko-theme-icon>` y el CSS que Meeko añade a `<head>`",
  "muestra el de `data-theme-choice` de `<html>`, así que nunca salta. Sin JavaScript es un formulario",
  "que envía `POST /_meeko/theme`.",
  "",
  "- `mode=\"cycle\"` (por defecto): un botón que pasa al tema siguiente.",
  "- `mode=\"select\"`: un grupo de radios accesible con el teclado.",
  "- `bind:themes`, `bind:labels` y `bind:messages`: la lista, sus nombres y los textos accesibles.",
  "- Un snippet por elección (`light`, `dark`, `system`…) con su icono.",
  "",
  "@example",
  "```html",
  "<MeekoThemeToggle>",
  "  <snippet name=\"light\"><IconSun /></snippet>",
  "  <snippet name=\"dark\"><IconMoon /></snippet>",
  "  <snippet name=\"system\"><IconMonitor /></snippet>",
  "</MeekoThemeToggle>",
  "```",
  "@see https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekothemetoggle",
);

/** JSDoc of a built-in component with a module of its own, its own or from the editor's table. */
function shippedTagDeclaration(tag: string): string {
  if (tag === "MeekoThemeToggle") return themeToggleDocs;
  if (tag === "MeekoAwait") return awaitDocs;
  const entry = builtinTag(tag);
  return entry ? jsdoc(entry.summary, "", `@see ${entry.guide}`) : "";
}

/**
 * JSDoc of `<MeekoAwait>`: like `<MeekoThemeToggle>`, the compiled component that Meeko ships. Its
 * `for` is an expression, and its content reads the data of `for` as loaded.
 */
const awaitDocs = jsdoc(
  "Etiqueta propia de Meeko (desde 1.5): la zona de unos datos que llegan después del primer pintado,",
  "el resultado de `useApi` o `useRpcQuery` sin `await`. Pinta el snippet `pending` en la primera carga,",
  "`error` (con `error` y `retry`) si falla, y su contenido cuando hay datos, que conserva durante las",
  "recargas (`refreshing`). `aria-busy` marca la zona mientras carga.",
  "",
  "- `for=\"items\"` o `for=\"[items, stats]\"`: los recursos, como expresión.",
  "- `reserve`: mientras espera, la altura que tuvo con datos; `reserve=\"320px\"` añade un mínimo.",
  "",
  "@example",
  "```html",
  "<MeekoAwait for=\"items\" reserve>",
  "  <snippet name=\"pending\"><ItemsSkeleton /></snippet>",
  "  <ItemsList bind:items=\"items.data.value\" />",
  "</MeekoAwait>",
  "```",
  "@see https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekoawait",
);

/** JSDoc of the component compile-time macros, each owned by its own module. */
const macroDocs = {
  defineProps: definePropsDocs,
  defineEmits: defineEmitsDocs,
  defineExpose: defineExposeDocs,
  defineModel: defineModelDocs,
  defineSnippets: defineSnippetsDocs,
  useElementRef: useElementRefDocs,
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
  "Desde 1.3 el valor debe ser un `TrustedHtml`: un `string` sin marcar (o `any`) da el aviso `MEEK107`.",
  "Sanee el HTML ajeno (por ejemplo, con DOMPurify) y márquelo con `trustHtml(…)`, que no sanea: sólo declara.",
  "",
  "El elemento no admite hijos y `html` no va en elementos vacíos (`<img>`), de texto (`<textarea>`, `<script>`),",
  "en `<template>` ni junto a `model` (`MEEK095`).",
  "",
  `@see ${apiDocs}#html-sin-escapar-con-html`,
].join("\n");

/** Type check of `html="..."`, declared only where the template has one. */
/** Attributes of a component tag that are no static prop: `is`, `ref` and `html` (MEEK032), the model `model` and `bind="obj"`. */
const reservedTagAttributes = new Set(["is", "ref", "html", "model", "bind"]);

/** Helpers of `<component is>` with an HTML tag and of `bind="obj"`, declared where the template has them. */
const dynamicTagDeclarations = [
  // Since 1.8 `is` also names `'MeekoLink'` and the project's components (`__MeekoIsName`), which completion offers.
  "declare function __meeko_tag_name(value: import(\"@meekojs/meeko\").TagName | __MeekoIsName): void;",
  "declare function __meeko_tag_of<const T extends string>(value: T): T;",
  "declare function __meeko_dynamic(value: import(\"@meekojs/meeko\").TagName | import(\"@meekojs/meeko\").Component<never>): void;",
  "declare function __meeko_component_part<T>(value: T): Exclude<T, string>;",
  "",
].join("\n");
const spreadDeclarations = [
  "declare function __meeko_spread<Tag extends string>(value: import(\"@meekojs/meeko\").ElementAttributes<Tag> | null | undefined): void;",
  "declare function __meeko_props_spread<M>(component: M, value: { readonly [K in keyof __MeekoPropsOf<M>]?: __MeekoPropsOf<M>[K] } | null | undefined): void;",
  "",
].join("\n");

const htmlDeclaration = `${jsdoc(...htmlDirectiveDocs.split("\n"))}\ndeclare function __meeko_html(html: string | null | undefined): void;\n`;

/** Construye el TypeScript virtual que relaciona script y plantilla. */
export function createVirtualComponent(source: string, filename: string, options: VirtualComponentOptions = {}): VirtualComponent {
  const document = parseSfc(source, filename);
  /** Built-in components with a module of their own (`<MeekoPopover>`), by tag. */
  const shippedTags = new Map<string, string>();
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
  /** Default values as written, from the argument or the destructuring of `defineProps` (since 1.8). */
  let defaultTexts = new Map<string, string>();
  /** Literal type of each default that is a literal (`kind = "a"`), as the compiler writes it. */
  let defaultLiterals = new Map<string, string>();
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
      defaultTexts = propsDefaultTexts(declaration, scriptFile);
      defaultLiterals = propsDefaultLiteralTypes(declaration, scriptFile);
      // The defaults of a destructuring (`size = "md"`) make the prop optional for the parent too.
      defaultKeys = [...new Set([...defaultKeys, ...defaultTexts.keys()])];
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
    // Like `SnippetTypes` and `SnippetMap` of the package: each key is a tuple or a `Snippet<Args>`
    // of another component's map. Distributive, so an optional snippet (`title?: []`) keeps its
    // tuple without `undefined`.
    code += "type __MeekoSnippetParameters<A> = A extends readonly unknown[] ? A : A extends import(\"@meekojs/meeko\").Snippet<infer P extends readonly unknown[]> ? P : never;\n";
    code += "type __MeekoSnippetMap<T> = { [K in keyof T]: import(\"@meekojs/meeko\").Snippet<__MeekoSnippetParameters<T[K]>> };\n";
    code += `${macroDocs.defineSnippets}\ndeclare function defineSnippets<T extends { readonly [name: string]: readonly unknown[] | import("@meekojs/meeko").Snippet<never> | undefined } | { [K in keyof T]: readonly unknown[] | import("@meekojs/meeko").Snippet<never> }>(): __MeekoSnippetMap<T>;\n`;
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
  // Meeko's own tags, unless a component of the project takes their name (MEEK106), as the compiler does.
  const registry = options.registry ?? discoverAutoImportsSync(projectRoot(filename));
  const shadowedTags = shadowedBuiltinTags(document.script.content, autoImportedValues(registry));
  /** Names that a string literal of `is` may give, as the compiler resolves them: `'MeekoLink'` and the PascalCase values in scope. */
  const isNames = (): Set<string> => new Set(["MeekoLink", ...[...autoImportedValues(registry), ...scriptValueNames(document.script.content)].filter(isComponentName)]);
  /** Branches of `<component is>` with names (1.8), visited as their own tags; the branch of tags, with its tags. */
  const branchNodes = new WeakMap<TemplateNode, { readonly tags?: readonly string[] }>();
  /** Props types of each built-in tag of the template and the checks of their props, declared after it. */
  const builtinDeclarations: string[] = [];
  const builtinChecks = new Map<string, string>();
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
  /** Variables of the tags of `<component is>`, and whether the template needs their helpers or those of `bind="obj"`. */
  let tagVariables = 0;
  let dynamicTags = false;
  let spreads = false;
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

  /** Raw name of an attribute as written: `bind:params`, `on:click`. */
  const rawNameOf = (attribute: NonNullable<TemplateNode["attrs"]>[number]): string =>
    /^[^\s=]+/.exec(source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name;

  /**
   * The props type of a built-in tag for hover and definition (`__MeekoBuiltinProps0`), from its
   * static attributes, and the type of its snippets (`__MeekoBuiltinProps0Snippets`) when they
   * depend on the application.
   */
  const builtinAlias = (node: TemplateNode, tag: BuiltinTag): string => {
    const alias = `__MeekoBuiltinProps${builtinDeclarations.length}`;
    const statics = new Map<string, string>();
    for (const attribute of node.attrs ?? []) {
      const prop = builtinTagProp(tag, rawNameOf(attribute));
      if (prop && !rawNameOf(attribute).startsWith("bind:") && attributeValueStart(source, attribute) !== undefined) statics.set(prop.name, attribute.value);
    }
    builtinDeclarations.push(`type ${alias} = import("@meekojs/meeko/framework").${tag.propsType}${tag.typeArguments?.(statics) ?? ""};\n`);
    if (tag.snippetsType) builtinDeclarations.push(`type ${alias}Snippets = import("@meekojs/meeko/framework").${tag.snippetsType};\n`);
    return alias;
  };

  /**
   * `<MeekoLink to="/users/[id]" bind:params="…">`: its props type for hover and definition, and a
   * typed call with its props (`__meeko_builtin_MeekoLink({ to: "/users/[id]", params: (…) })`), so
   * the names, values and completions of its attributes have the types of `MeekoLinkProps`.
   */
  const visitBuiltin = (node: TemplateNode, tag: BuiltinTag): void => {
    const attrs = node.attrs ?? [];
    const alias = builtinAlias(node, tag);
    const endTag = node.selfClosing ? undefined : node.sourceCodeLocation?.endTag;
    componentTags.push({
      name: tag.name,
      start: node.start + 1,
      ...(endTag ? { closeStart: document.template.contentStart + endTag.startOffset + 2 } : {}),
      builtin: { name: tag.name, alias },
    });
    if (!tag.props.length) return;
    const check = `__meeko_builtin_${tag.name}`;
    if (tag.check?.declarations) builtinChecks.set(`${check}:types`, tag.check.declarations);
    builtinChecks.set(check, `declare function ${check}${tag.check?.parameters ?? ""}(props: ${tag.check?.props ?? `import("@meekojs/meeko/framework").${tag.propsType}`}): void;\n`);
    code += `${check}({ `;
    for (const attribute of attrs) {
      const rawName = rawNameOf(attribute);
      const prop = builtinTagProp(tag, rawName);
      if (!prop) continue;
      // The prop's name keeps the span of the attribute's name, after `bind:`.
      if (rawName.endsWith(prop.name)) mapped(prop.name, attribute.start + rawName.length - prop.name.length);
      else code += prop.name;
      code += ": ";
      const valueStart = attributeValueStart(source, attribute);
      if (!rawName.startsWith("bind:")) {
        if (valueStart === undefined) code += "true";
        else mapped(JSON.stringify(attribute.value), /["']/.test(source[valueStart - 1] ?? "") ? valueStart - 1 : valueStart);
      } else if (attribute.value.trim() && valueStart !== undefined) {
        code += "(";
        mapped(attribute.value, valueStart);
        code += ")";
      } else code += "undefined";
      code += ", ";
    }
    code += "});\n";
  };

  /**
   * `<component is>` with component names (1.8), as the compiler splits it: each name is its own
   * tag, whose name maps to its literal (hover and definition of `'UICard'`), and the HTML tags one
   * element; each one behind the condition of `?:` that leads to it, with the attributes it takes.
   */
  const visitNamedIs = (node: TemplateNode, leaves: readonly IsLeaf[]): void => {
    const own = (node.attrs ?? []).filter((attribute) => !/^(?:if|each):/.test(attribute.name) && !attribute.name.startsWith("ref:"));
    const reference = own.find((attribute) => attribute.name === "is");
    const referenceStart = reference ? attributeValueStart(source, reference) : undefined;
    if (referenceStart === undefined) return;
    const names = new Map<string, IsLeaf[]>();
    const rest: IsLeaf[] = [];
    for (const leaf of leaves) {
      if (leaf.literal === undefined) continue;
      if (isComponentName(leaf.literal)) names.set(leaf.literal, [...names.get(leaf.literal) ?? [], leaf]);
      else rest.push(leaf);
    }
    const tags = [...new Set(rest.map((leaf) => leaf.literal!))];
    const elementChildren = (node.childNodes ?? []).filter((child) => child.tagName !== "snippet");
    const branch = (list: readonly IsLeaf[], target: TemplateNode, mark: { readonly tags?: readonly string[] }): void => {
      const text = isBranchCondition(list, (part) => part);
      code += `if (${text}) {\n`;
      guards.push({ text, names: new Set(freeIdentifiers(text).map(({ name }) => name)) });
      branchNodes.set(target, mark);
      visit(target);
      guards.pop();
      code += "}\n";
    };
    for (const [name, list] of names) {
      const link = name === "MeekoLink" && !shadowedTags.has(name);
      const attrs = own.filter((attribute) => attribute !== reference && branchTakes(attribute, rawNameOf(attribute), link ? { kind: "link" } : { kind: "component" }));
      // The tag starts at the opening quote: its name is the literal; it has no closing tag of its own.
      branch(list, { ...node, nodeName: name, tagName: name, componentName: name, start: referenceStart + list[0]!.offset, selfClosing: true, attrs, ...(link ? { childNodes: elementChildren } : {}) }, {});
    }
    if (rest.length) {
      const attrs = own.filter((attribute) => attribute === reference || branchTakes(attribute, rawNameOf(attribute), { kind: "tags", tags }));
      branch(rest, { ...node, attrs, childNodes: elementChildren }, { tags });
    }
  };

  /**
   * Agrega una expresión conservando su posición original. Con `pieces`, los de una interpolación
   * con referencias de carácter (`{x &amp;&amp; y}`), cada tramo tiene su span.
   */
  const expression = (value: string, sourceStart: number, pieces?: readonly DecodedExpressionPiece[]): void => {
    code += "void (";
    const generatedStart = code.length;
    code += value;
    if (pieces) {
      for (const piece of pieces) {
        spans.push({ sourceStart: sourceStart + piece.sourceStart, sourceEnd: sourceStart + piece.sourceEnd, generatedStart: generatedStart + piece.start, generatedEnd: generatedStart + piece.end });
      }
    } else spans.push({ sourceStart, sourceEnd: sourceStart + value.length, generatedStart, generatedEnd: code.length });
    code += ");\n";
  };

  const mapped = (value: string, sourceStart: number): void => {
    const generatedStart = code.length;
    code += value;
    spans.push({ sourceStart, sourceEnd: sourceStart + value.length, generatedStart, generatedEnd: code.length });
  };

  /**
   * The empty value of an expression attribute (`bind:item=""`, `on:save=""`, `model=""`):
   * `undefined`, with the opening of its quotes mapped before it, so completion inside the quotes
   * offers the expressions that the prop's type expects.
   */
  const emptyValue = (attribute: NonNullable<TemplateNode["attrs"]>[number]): void => {
    const start = attributeValueStart(source, attribute);
    if (start !== undefined) mapped("", start);
    code += " undefined";
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
    // `<MeekoLink>` is the `<a>` it renders and `<MeekoOutlet />` the page inside: not a component of the script.
    // `<MeekoThemeToggle>` is a component that Meeko ships: a component tag, with the table's hover.
    const meekoTag = node.componentName !== undefined && !shadowedTags.has(node.componentName) ? builtinTag(node.componentName) : undefined;
    const builtin = meekoTag?.component ? undefined : meekoTag;
    const refDirective = attrs.find((attr) => attr.name.startsWith("ref:"));
    if (refDirective) {
      const name = /^[^\s=]+/.exec(source.slice(refDirective.start, refDirective.end))?.[0].slice(4) ?? "";
      const dynamic = !builtin && node.componentName === undefined && node.tagName === "component" ? attrs.find((attr) => attr.name === "is")?.value.trim() : undefined;
      const candidates = dynamic ? isCandidates(dynamic) : undefined;
      // `<component is>` whose results are all tags is one of their elements; otherwise it may also be a component.
      const tags = candidates && candidates.others.length === 0 ? candidates.tags.map((literal) => JSON.stringify(literal.tag)).join(" | ") : undefined;
      const reference = builtin || tags ? undefined : node.componentName ?? dynamic;
      const listed = listDepth > 0 || list !== undefined;
      let type: string;
      if (tags) type = `__MeekoElementOf<${tags}, false>`;
      else if (candidates && candidates.tags.length > 0 && reference !== undefined && !listed && snippetDepth === 0) {
        const helper = `__meeko_ref_${refHelpers.length}`;
        refHelpers.push(`const ${helper} = () => (${reference});\n`);
        type = `__MeekoElementOf<Extract<ReturnType<typeof ${helper}>, string>, false> | __MeekoExposedOf<Exclude<ReturnType<typeof ${helper}>, string>>`;
      } else if (reference !== undefined && !listed && snippetDepth === 0 && reference.trim()) {
        // Like the compiled component, the exposed value comes from the tag check and its props.
        const helper = `__meeko_ref_${refHelpers.length}`;
        refHelpers.push(`const ${helper} = () => __meeko_tag((${reference}))(${tagProps(attrs)}, null!, null!, null!);\n`);
        type = `__MeekoTagExposed<ReturnType<typeof ${helper}>>`;
      } else type = reference !== undefined
        ? (/^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*$/.test(reference) ? `__MeekoExposedOf<typeof ${reference}>` : "unknown")
        : `__MeekoElementOf<${JSON.stringify(builtin ? builtin.element ?? "" : node.tagName ?? "")}, ${node.namespaceURI === "http://www.w3.org/2000/svg"}>`;
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
    const componentName = builtin ? undefined : node.componentName;
    let reference = componentName === undefined && node.tagName === "component" ? attrs.find((attr) => attr.name === "is") : undefined;
    if (builtin) visitBuiltin(node, builtin);
    // `<component is="href ? 'a' : 'button'">`: every result is a tag, so it is an element whose
    // events and refs see the union of those elements, like the compiler's.
    let tagType: string | undefined;
    const referenceStart = reference ? attributeValueStart(source, reference) : undefined;
    // Since 1.8 `is` may name components (`to ? 'MeekoLink' : 'a'`): each branch is its own tag.
    const branchTags = branchNodes.get(node)?.tags;
    const leaves = reference && referenceStart !== undefined && reference.value.trim() && !branchTags ? isLeaves(reference.value) : [];
    const named = leaves.some((leaf) => leaf.literal !== undefined && isComponentName(leaf.literal));
    if (named) {
      visitNamedIs(node, leaves);
      childrenVisited = true;
      reference = undefined;
    } else if (reference && referenceStart !== undefined && reference.value.trim()) {
      const candidates = isCandidates(reference.value);
      if (candidates.others.length === 0) {
        // The mapped copy completes the tags that `is` admits; the other one keeps their literal types.
        // In the branch of tags of an `is` with names, the type is that of its tags.
        const variable = `__meeko_tag_${tagVariables++}`;
        code += "__meeko_tag_name((";
        mapped(reference.value, referenceStart);
        code += `));\nconst ${variable} = ${branchTags ? `null! as ${branchTags.map((tag) => JSON.stringify(tag)).join(" | ")}` : `__meeko_tag_of((${reference.value}))`};\n`;
        tagType = `typeof ${variable}`;
        dynamicTags = true;
        reference = undefined;
      }
    }
    if (componentName !== undefined || reference) {
      // An empty `if:when=""` still completes expressions, as on an element.
      if (condition && !narrows && conditionStart !== undefined) {
        code += "void (";
        emptyValue(condition);
        code += ");\n";
      }
      const value = componentName ?? reference!.value;
      const valueStart = componentName !== undefined ? node.start + 1 : attributeValueStart(source, reference!) ?? reference!.start;
      if (componentName !== undefined) {
        if (meekoTag?.module) shippedTags.set(meekoTag.name, meekoTag.module);
        const endTag = node.selfClosing ? undefined : node.sourceCodeLocation?.endTag;
        componentTags.push({
          name: componentName,
          start: valueStart,
          ...(endTag ? { closeStart: document.template.contentStart + endTag.startOffset + 2 } : {}),
          ...(meekoTag ? { builtin: { name: meekoTag.name, alias: builtinAlias(node, meekoTag) } } : {}),
        });
      }
      // One tag call, like the compiled component: a generic child infers its type parameters from
      // the props, and they type the handlers, the models and the snippets.
      // `<component is>` may also give a tag: the props are checked against its components.
      const dynamic = componentName === undefined;
      // With a tag literal among its results, the first mapping of `is` completes the tags too.
      const literals = dynamic && isCandidates(value).tags.length > 0;
      if (literals) {
        code += "void __meeko_dynamic((";
        mapped(value, valueStart);
        code += "));\n";
        dynamicTags = true;
      }
      code += dynamic ? "__meeko_tag(__meeko_component_part((" : "__meeko_tag((";
      mapped(value, valueStart);
      code += dynamic ? ")))(" : "))(";
      mapped("{", valueStart);
      code += " ";
      /** `bind="obj"`: its props come first, so the explicit ones win, as in the compiler. */
      const spread = attrs.find((attribute) => attribute.name === "bind" && attribute.value.trim() !== "" && attributeValueStart(source, attribute) !== undefined);
      if (spread) code += `...(${spread.value}), `;
      for (const attribute of attrs) {
        const rawName = /^[^\s=]+/.exec(source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name;
        if (rawName.startsWith("bind:")) mapped(rawName.slice(5), attribute.start + 5);
        // `<MeekoAwait for="items">`: `for` is an expression, as `bind:for`.
        else if (rawName === "for" && meekoTag?.name === "MeekoAwait") mapped(rawName, attribute.start);
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
        else emptyValue(attribute);
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
      // Children of `<AppDialog>` and, since 1.5, of `<component is>` are snippets.
      // `<MeekoAwait for="items">` shows its content with the data: it reads `items.data.value` as loaded.
      const forAttribute = meekoTag?.name === "MeekoAwait" ? attrs.find((attr) => /^(?:bind:)?for$/.test(rawNameOf(attr))) : undefined;
      visitSnippets(node, forAttribute ? awaitForReferences(forAttribute.value).map(({ text }) => `${text}.data.value`) : []);
      childrenVisited = true;
      code += ");\n";
      if (spread) {
        // The keys of `bind="obj"` are the child's props, which completion offers.
        code += `__meeko_props_spread(${dynamic ? "__meeko_component_part(" : ""}(${value})${dynamic ? ")" : ""}, (`;
        mapped(spread.value, attributeValueStart(source, spread)!);
        code += "));\n";
        spreads = true;
      }
      for (const attribute of attrs) {
        const rawName = /^[^\s=]+/.exec(source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name;
        if ((rawName !== "model" && !rawName.startsWith("model:")) || !attribute.value.trim()) continue;
        code += "__meeko_writable(";
        mapped(attribute.value, attributeValueStart(source, attribute) ?? attribute.start);
        code += ");\n";
      }
      // After the tag call, whose mapping of the name comes first for hover and definition.
      if (dynamic) {
        // A component or an HTML tag: completion offers both.
        if (!literals) {
          code += "void __meeko_dynamic((";
          mapped(value, valueStart);
          code += "));\n";
        }
        dynamicTags = true;
      } else {
        code += "void ((";
        mapped(value, valueStart);
        code += ") satisfies import(\"@meekojs/meeko\").Component<never>);\n";
      }
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
      } else if (snippet && snippetStart !== undefined) {
        // `snippet=""` being written: completion inside the quotes offers the snippets.
        code += "__meeko_render((";
        emptyValue(snippet);
        code += "), []);\n";
      }
    } else if (!named && (!builtin || builtin.element)) {
      // A built-in tag's other attributes go to the element it renders, as in the compiler.
      const element: TemplateNode = builtin ? { ...node, tagName: builtin.element!, attrs: attrs.filter((attr) => !builtinTagProp(builtin, rawNameOf(attr))) } : node;
      const elementAttrs = element.attrs ?? [];
      // On a custom element (`<x-markdown html="intro">`), `html` and `model` are plain HTML
      // attributes, as in the compiler: their value is text, not an expression.
      const directives = element.tagName !== undefined && !isCustomElementTag(element.tagName);
      // `model="signal"` on a form control: the signal type of the control, and writable.
      const model = directives ? elementAttrs.find((attr) => attr.name === "model") : undefined;
      const modelStart = model ? attributeValueStart(source, model) : undefined;
      const kind = nativeModelKind(element);
      if (model?.value.trim() && modelStart !== undefined && kind) {
        code += `void ((): { value: __MeekoNativeModels[${JSON.stringify(kind)}] } => (`;
        mapped(model.value, modelStart);
        code += "));\n__meeko_writable(";
        mapped(model.value, modelStart);
        code += ");\n";
      } else if (model && modelStart !== undefined && kind) {
        // `model=""` being written: the control's type stands for completion inside the quotes.
        code += `void ((): { value: __MeekoNativeModels[${JSON.stringify(kind)}] } => (`;
        emptyValue(model);
        code += "));\n";
      }
      // `html="expression"`: unescaped HTML, typed `string | null | undefined`.
      const html = directives ? elementAttrs.find((attr) => attr.name === "html") : undefined;
      if (html) {
        htmlDirectives.push({ start: html.start, end: html.start + "html".length });
        const htmlStart = attributeValueStart(source, html);
        if (html.value.trim() && htmlStart !== undefined) {
          code += "__meeko_html(";
          mapped(html.value, htmlStart);
          code += ");\n";
        }
      }
      for (const attr of elementAttrs) {
        // `bind="obj"`: its keys are the attributes of the tag, which completion offers.
        if (attr.name === "bind" && directives) {
          const start = attributeValueStart(source, attr);
          if (start === undefined || !attr.value.trim()) continue;
          code += `__meeko_spread<${tagType ?? JSON.stringify(element.tagName ?? "")}>((`;
          mapped(attr.value, start);
          code += "));\n";
          spreads = true;
          continue;
        }
        if (!/^(?:bind|on|if|each):/.test(attr.name) && !(element.tagName === "component" && attr.name === "is" && tagType === undefined)) continue;
        if (["each:of", "each:as", "each:index"].includes(attr.name)) continue;
        if (attr === condition && narrows) continue;
        const start = attributeValueStart(source, attr);
        if (start === undefined) continue;
        if (attr.name.startsWith("on:")) {
          const eventType = templateEventType("__Meeko", attr.name.slice(3), element.tagName ?? "", element.namespaceURI === "http://www.w3.org/2000/svg", tagType);
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
        if (!segment.expression) {
          // `{}` being written: `undefined` stands for it, so completion inside the braces works.
          code += "void (";
          mapped("", node.start + segment.expressionStart);
          code += " undefined);\n";
          continue;
        }
        // Entities decode without markup: a `<` of the code (`{a<b&&c}`) never opens a tag.
        const decoded = decodeTemplateExpression(segment.expression);
        expression(decoded.text, node.start + segment.expressionStart, decoded.pieces);
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
      else emptyValue(attribute);
      code += ", ";
    }
    code += "}";
  };

  /**
   * Children of a component tag: loose content fills `default` and each `<snippet name params>`
   * fills its snippet, as a function whose parameters the child's defineSnippets types.
   */
  const visitSnippets = (node: TemplateNode, defaultNarrowing: readonly string[] = []): void => {
    const children = node.childNodes ?? [];
    const loose = children.filter((child) => child.tagName !== "snippet");
    /** The default snippet also runs behind `defaultNarrowing` (the data of `<MeekoAwait for>`). */
    const narrowDefault = (): number => {
      for (const text of defaultNarrowing) guards.push({ text, names: new Set(freeIdentifiers(text).map(({ name }) => name)) });
      return defaultNarrowing.length;
    };
    snippetDepth++;
    code += "{ ";
    if (loose.some((child) => child.nodeName !== "#comment" && (child.nodeName !== "#text" || Boolean(child.value?.trim())))) {
      code += "\"default\": __meeko_snippet(() => {\n";
      const pushed = narrowDefault();
      const guarded = reguard([]);
      for (const child of loose) visit(child);
      code += guarded ? "}\n}),\n" : "}),\n";
      guards.splice(guards.length - pushed, pushed);
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
      else if (nameStart !== undefined && /^[A-Za-z_$][\w$-]*$/.test(name)) {
        // A hyphenated name (`cell-email`, since 1.8) is a quoted key, mapped with the attribute's
        // quotes; one still being typed (`cell-`) too, so it completes. The compiler checks its form.
        mapped(JSON.stringify(name), nameStart - 1);
      } else if (nameStart !== undefined && !name) {
        mapped("", nameStart);
        code += "__meeko_snippet_name";
      } else code += JSON.stringify(name);
      code += ": ";
      // `if:when` passes the snippet only while its condition is true: like the compiler, the
      // value keeps the snippet's type and its content is narrowed by the condition.
      const condition = attrs.find((attr) => attr.name === "if:when");
      const conditionStart = condition ? attributeValueStart(source, condition) : undefined;
      const conditional = condition !== undefined && conditionStart !== undefined && condition.value.trim() !== "";
      if (conditional) {
        code += "!!(";
        mapped(condition.value, conditionStart);
        code += ") ? ";
        guards.push({ text: condition.value, names: new Set(freeIdentifiers(condition.value).map(({ name }) => name)) });
      }
      code += "__meeko_snippet((";
      // Only a list of identifiers is mapped; anything else is MEEK061 in the compiler.
      if (paramsAttribute && paramsStart !== undefined && /^\s*(?:[A-Za-z_$][\w$]*\s*(?:,\s*[A-Za-z_$][\w$]*\s*)*)?$/.test(paramsAttribute.value)) {
        mapped(paramsAttribute.value, paramsStart);
      }
      code += ") => {\n";
      const pushed = name === "default" ? narrowDefault() : 0;
      const guarded = reguard((paramsAttribute?.value ?? "").split(",").map((param) => param.trim()).filter(Boolean));
      for (const grandchild of child.childNodes ?? []) visit(grandchild);
      code += guarded ? "}\n})" : "})";
      guards.splice(guards.length - pushed, pushed);
      if (conditional) {
        code += " : undefined!";
        guards.pop();
      }
      code += ",\n";
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
  code += builtinDeclarations.join("");
  code += [...builtinChecks.values()].join("");
  code += channelDeclarations;
  if (code.includes("__meeko_snippet(") || code.includes("__meeko_render(")) code += snippetDeclarations;
  if (code.includes("__meeko_html(")) code += htmlDeclaration;
  if (dynamicTags) code += `type __MeekoIsName = ${[...isNames()].map((name) => JSON.stringify(name)).join(" | ")};\n${dynamicTagDeclarations}`;
  if (spreads) code += spreadDeclarations;
  // `<MeekoThemeToggle>`, `<MeekoAwait>`, `<MeekoPopover>` and `<MeekoSelect>` are the compiled modules that the component imports.
  for (const [tag, module] of shippedTags) code += `${shippedTagDeclaration(tag)}\ndeclare const ${tag}: typeof import(${JSON.stringify(module)});\n`;
  if (code.includes("__MeekoEventOf<")) code += `${templateEventDeclaration}\n`;
  // `useElementRef` is a compiler macro typed from the template, like the compiled component.
  code += "type __MeekoExposedOf<M> = M extends { readonly hydrateScope: (...args: never[]) => infer R } ? R extends { readonly exposed?: infer E } ? (unknown extends E ? null : E) : null : null;\n";
  code += "type __MeekoElementOf<Tag extends string, Svg extends boolean> = Svg extends true ? Tag extends keyof SVGElementTagNameMap ? SVGElementTagNameMap[Tag] : SVGElement : Tag extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[Tag] : HTMLElement;\n";
  code += `type __MeekoRefs = { ${[...refs].map(([name, ref]) => `${JSON.stringify(name)}: ${ref.type}`).join("; ")} };\n`;
  code += `type __MeekoListRefs = ${[...refs].filter(([, ref]) => ref.list).map(([name]) => JSON.stringify(name)).join(" | ") || "never"};\n`;
  // A component without defineExpose has nothing to await: its `then` is not a promise's (MEEK080).
  code += `${useElementRefUnexposedEditorType}\n`;
  code += `${macroDocs.useElementRef}\n`;
  code += `${useElementRefEditorDeclaration}\n`;
  // The module shape of the compiled component, so another component that imports this one
  // in the shared editor project sees its props, including the `onEvent` callbacks.
  const declaredProps = propsTypeText ?? "Record<string, never>";
  // A generic component declares its parameters on each type (G) and passes them on (A).
  const G = generic ? `<${generic.declaration}>` : "";
  const A = generic ? `<${generic.names.join(", ")}>` : "";
  const K = generic ? "__K" : "K";
  // Each member of a union of props on its own, as the compiler does: a default of a prop that a
  // member declares `never` does not let the parent pass it in that member.
  const inputProps = defaultKeysType
    ? `__MeekoInputPropsOf<__MeekoDeclaredProps${A}>`
    : `__MeekoDeclaredProps${A}`;
  // A literal default makes its prop optional only in the members whose type admits it (`kind = "a"`
  // does not let the parent omit `kind: "b"`), as the compiler does; another default, in every
  // member that declares its prop (the compiled check reports `MEEK131` if one cannot take it).
  if (defaultKeysType) {
    code += defaultLiterals.size
      ? `${defaultLiteralType(Object.fromEntries(defaultLiterals))}\ntype __MeekoFittingDefaultKeys<__P> = { [${K} in (${defaultKeysType}) & keyof __P]: ${K} extends ${[...defaultLiterals.keys()].map((key) => JSON.stringify(key)).join(" | ")} ? Exclude<__P[${K}], undefined> extends infer __V ? [__MeekoDefaultLiteral<__P, ${K}>] extends [__V] ? ${K} : never : never : ${K} }[(${defaultKeysType}) & keyof __P];\n`
      : `type __MeekoFittingDefaultKeys<__P> = (${defaultKeysType}) & keyof __P;\n`;
    code += `type __MeekoInputPropsOf<__P> = __P extends unknown ? Omit<__P, __MeekoFittingDefaultKeys<__P>> & { [${K} in keyof Pick<__P, __MeekoFittingDefaultKeys<__P>>]?: __P[${K}] | undefined } : never;\n`;
  }
  // The default values as written, for the hover and the completion of a parent's tag.
  code += `export type ComponentDefaults = ${componentDefaultsType(defaultTexts)};\n`;
  code += `type __MeekoDeclaredProps${G} = ${declaredProps};\n`;
  // Named so the editor can list the events of this component on a parent's tag.
  if (emitsTypeText) code += `type __MeekoEmits${G} = ${emitsTypeText};\n`;
  code += "type __MeekoEmitPropsOf<T> = { [K in keyof T & string as `on${Capitalize<K>}`]?: ((...args: T[K] extends readonly unknown[] ? T[K] : never) => void) | undefined };\n";
  code += `type __MeekoComponentProps${G} = (${inputProps})${emitsTypeText ? ` & __MeekoEmitPropsOf<__MeekoEmits${A}>` : ""};\nexport type { __MeekoComponentProps as ComponentProps };\n`;
  code += `type __MeekoPropsOnly${G} = (${inputProps});\nexport type { __MeekoPropsOnly };\n`;
  code += `${emitsTypeText ? "" : `type __MeekoEmits${G} = {};\n`}export type { __MeekoEmits as ComponentEmits };\n`;
  // Structural, without importing the package: it satisfies `Component<ComponentProps>`.
  code += `export declare function renderToString${G}(props: __MeekoComponentProps${A}, state?: Record<string, unknown>): string;\n`;
  code += `export declare function renderWithState${G}(props: __MeekoComponentProps${A}): { html: string; state: Record<string, unknown> };\n`;
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
  code += `export declare const __meekoTag: ${G}(props: __MeekoTagProps<__MeekoComponentProps${A}> & __MeekoExtraProps, events: NoInfer<__MeekoEventNames<__MeekoComponentProps${A}>>, models: NoInfer<__MeekoTagModels<ComponentModels${A}>>, snippets: NoInfer<__MeekoTagSnippets<ComponentSnippets${A}>>) => { readonly typeArguments: { ${typeArguments} }; readonly props: __MeekoComponentProps${A}; readonly events: ${emitsTypeText ? `__MeekoEmits${A}` : "{}"}; readonly models: ComponentModels${A}; readonly snippets: ComponentSnippets${A}; readonly exposed: ComponentExposed${A}; readonly defaults: ComponentDefaults };\n`;
  code += `export declare function hydrateScope${G}(scope: object, props: __MeekoComponentProps${A}, state?: Record<string, unknown>): { (): void; readonly exposed?: ComponentExposed${A} };\n`;
  code += `export declare function hydrate${G}(root: object, props: __MeekoComponentProps${A}, state?: Record<string, unknown>): () => void;\n`;
  code += "export declare const css: string;\n";
  // Every component is an ES module, like the compiler output; this keeps the
  // declarations of components that share a TypeScript project isolated.
  code += "export {};\n";

  const target = resolve(filename).replaceAll("\\", "/").includes("/server/") ? "server" : "client";
  const resolved = { ...options, registry };
  const files = componentTags.length ? componentFiles(scriptFile, filename, registry) : new Map<string, string>();
  const component: VirtualComponent = {
    ...finishVirtual(filename, virtualFilenameOf(filename), source, code, spans, resolved, target, serverExports),
    ...(serverExports.length ? { serverExports } : {}),
    componentTags: componentTags.map((tag) => !tag.builtin && files.has(tag.name) ? { ...tag, file: files.get(tag.name)! } : tag),
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
    // A component imported through a path alias (`@/components/Card.meeko`): the first file that exists.
    const aliased = !specifier.startsWith(".") && specifier.endsWith(".meeko")
      ? aliasCandidates(resolveProjectAliasesSync(projectRoot(filename)).aliases, specifier)?.find((candidate) => existsSync(candidate))
      : undefined;
    for (const name of names) {
      if (!name) continue;
      if (specifier.startsWith(".") && specifier.endsWith(".meeko")) files.set(name, resolve(dirname(filename), specifier));
      else if (aliased) files.set(name, aliased);
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
      if (offset < from || offset > end) continue;
      const toEnd = direction === "source" ? span.generatedEnd : span.sourceEnd;
      // A character reference (`&lt;` → `<`) changes the length: its inner offsets go to an end.
      if (end - from !== toEnd - to) return offset === from ? to : toEnd;
      return to + offset - from;
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
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
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
 * Adds the project's path aliases (`~/`, `@/`, `#shared/`, `#server/` and those of `alias`) to
 * `options.paths` as absolute targets, every one of them: a component's `<script server>` sees
 * `#server/`, and `MEEK108` stops it in the `<script>`. The project's own `paths` win.
 */
function withAliasPaths(options: ts.CompilerOptions, directory: string, project: ProjectAliases): ts.CompilerOptions {
  const own = aliasTsconfigPaths(aliasesForScope(project.aliases, "all"), (target) => target.replaceAll("\\", "/"), {
    root: directory, directory: join(directory, ".meeko", "types"),
  });
  if (Object.keys(own).length === 0) return options;
  const result: ts.CompilerOptions = { ...options, paths: { ...own, ...options.paths } };
  // `paths` without `baseUrl` resolve from the tsconfig's folder; the aliases are absolute.
  if (result.baseUrl === undefined && (result as Record<string, unknown>)["pathsBasePath"] === undefined) {
    (result as Record<string, unknown>)["pathsBasePath"] = directory;
  }
  return result;
}

/**
 * Lee el tsconfig.json de la raíz del proyecto. El editor conserva sus opciones de tipos
 * (paths, lib, types, strict...) y sólo fuerza lo necesario para analizar componentes:
 * sin emisión, extensiones arbitrarias y `rootDirs` sobre `.meeko/types`. Añade a `paths` los
 * aliases de ruta del proyecto (`aliases`, o los de su configuración leída sin ejecutarla); los
 * `paths` propios del tsconfig ganan.
 */
export function resolveProjectCompilerOptions(root: string, aliases?: ProjectAliases): ProjectCompilerOptions {
  const directory = resolve(root);
  const project = aliases ?? resolveProjectAliasesSync(directory);
  const configFile = join(directory, "tsconfig.json");
  if (!existsSync(configFile)) return { options: withAliasPaths(defaultCompilerOptions(directory), directory, project), fileNames: [] };
  let failed = false;
  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => { failed = true; },
  });
  if (!parsed || failed) return { options: withAliasPaths(defaultCompilerOptions(directory), directory, project), fileNames: [], configFile };
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
  return { options: withAliasPaths(options, directory, project), fileNames, configFile };
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
  // Augmentations such as MeekoSession reach the component only as program roots.
  const declarations = [...projectDeclarationFiles(projectRoot(filename)), ...generatedServicesDeclaration(projectRoot(filename))];
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [...virtual.keys(), ...declarations],
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
