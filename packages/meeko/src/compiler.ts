import ts from "@typescript/typescript6";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { foreignContent } from "parse5";
import postcss from "postcss";

import type { EmitsDeclaration } from "./app/definitions/define-emits";
import type { ExposeDeclaration } from "./app/definitions/define-expose";
import type { ModelDeclaration } from "./app/definitions/define-model";
import type { PropsPattern } from "./app/definitions/define-props";
import type { SnippetsDeclaration } from "./app/definitions/define-snippets";
import type { PropsDefaultsCode } from "./compiler/codegen/props";
import type { ScriptComposables, StatementEdit } from "./compiler/composables";
import type { Guard } from "./compiler/expressions";
import type { GenericParameters } from "./compiler/generic";
import type { DecodedRegion, SourceMapping } from "./compiler/mapping";
import type { CompileDiagnostic, SfcSection } from "./compiler/parser/sfc";
import type { TemplateAttribute, TemplateNode } from "./compiler/parser/template";
import type { IsLeaf } from "./compiler/transforms/dynamic-tag";
import type { ScopeCandidate, ScopeTargets } from "./compiler/transforms/scope-targets";

import { analyzeEmits, emitNames, EmitsError } from "./app/definitions/define-emits";
import { analyzeExpose, ExposeError } from "./app/definitions/define-expose";
import { analyzeModels, ModelError } from "./app/definitions/define-model";
import { analyzePropsDeclaration, analyzePropsPattern, componentDefaultsType, definePropsCall, definePropsInitializer, nonstandardLocalPropsInterface, propsDefaultLiteralTypes, propsDefaultsConstants, PropsDefaultsError, propsDefaultTexts } from "./app/definitions/define-props";
import { analyzeSnippets, SnippetsError, snippetTypeParts } from "./app/definitions/define-snippets";
import { ElementRefError, resolveElementRef, validateElementRefBinding } from "./app/definitions/use-element-ref";
import { isTagName, isVoidTag } from "./app/runtime/dynamic-tag";
import { emitPropName } from "./app/runtime/emits";
import { closedAttributeValues, closedAttributeValuesOf } from "./compiler/attribute-values";
import { emitComponentChannels } from "./compiler/codegen/channels";
import { emitComponentProps } from "./compiler/codegen/props";
import { emitComponentRelease } from "./compiler/codegen/release";
import { analyzeComposables, ComposableError, conditionalComposable, freeIdentifiers, isExecutableStatement, nodeDepth } from "./compiler/composables";
import { instrumentNode, instrumentTemplateExpression, trackedRead } from "./compiler/devtools";
import { doubleBraces, doubleBracesMessage } from "./compiler/double-braces";
import { isFunctionLiteral, namesOf, narrowed, rewriteLocals, unshadowed, validateExpression } from "./compiler/expressions";
import { GenericError, genericReference, parseGeneric, sectionAttribute } from "./compiler/generic";
import { extractSourceMappings, markSource, remapDecodedRegions } from "./compiler/mapping";
import { scanInterpolations } from "./compiler/parser/interpolation";
import { compileError, locate, parseSfc } from "./compiler/parser/sfc";
import { attributeValueStart, decodeTemplateExpression, decodeTemplateText, expressionSourceOffset, isCustomElementTag, parseTemplate } from "./compiler/parser/template";
import { branchTakes, importedComponents, isBranchCondition, isCandidates, isComponentName, isLeaves, scriptValueNames } from "./compiler/transforms/dynamic-tag";
import { templateEventType } from "./compiler/transforms/events";
import { layoutShiftHints } from "./compiler/transforms/layout-shift";
import { PropAliasWriteError, rewritePropAliases } from "./compiler/transforms/prop-aliases";
import { propAliasReadsOnce, propsReadsOnce } from "./compiler/transforms/props-reactivity";
import { scopeCss } from "./compiler/transforms/scoped-css";
import { analyzeServerScript, bindingIdentifiers, checkClientScript } from "./compiler/transforms/server-script";
import { elementAttributeNames, tagsAccepting } from "./shared/html-attributes";

interface DynamicText {
  id: number;
  expression: string;
  offset: number;
}

interface EventBinding {
  id: number;
  name: string;
  expression: string;
  offset: number;
  /** Tag of the element, which types the event's `currentTarget`. */
  tag: string;
  svg: boolean;
  /** Type of the tags of `<component is>`, such as `typeof __meeko_tag_3`, instead of `tag`. */
  tagType?: string;
}

interface AttributeBinding {
  id: number;
  name: string;
  expression: string;
  offset: number;
  /**
   * Code built from several source expressions, such as the `href` of `<MeekoLink>`: `map` marks
   * each one at its own offset (SSR) or also rewrites list locals (hydration).
   */
  build?: (map: (expression: string, offset: number) => string) => string;
}

interface ConditionBinding {
  kind: "condition";
  id: number;
  expression: string;
  offset: number;
  /**
   * The condition built from parts of `expression`, such as the branch of `<component is>` with
   * names (since 1.8): `map` marks each part at its own offset, as {@link AttributeBinding.build}.
   */
  build?: (map: (expression: string, offset: number) => string) => string;
  render: string;
  bindings: TemplateBindings;
}

interface ListBinding {
  kind: "list";
  id: number;
  expression: string;
  offset: number;
  /** Absent without each:key: rows are keyed by index. */
  key?: string;
  keyOffset?: number;
  itemName: string;
  indexName: string;
  render: string;
  bindings: TemplateBindings;
}

/**
 * `<MeekoTeleport to="#toolbar" bind:disabled="…">` (since 1.5): its content, compiled in this
 * template like the content of an `if:when`, renders in another place of the document.
 */
interface TeleportBinding {
  kind: "teleport";
  id: number;
  /** `to`: the quoted text of a static `to`, at its opening quote, or a `bind:to` expression. */
  expression: string;
  offset: number;
  /** `bind:disabled`, or `true` for a bare `disabled` (`literal`). */
  disabled?: { expression: string; offset: number; length: number; literal?: true };
  render: string;
  bindings: TemplateBindings;
}

/** Static `ref="name"` of the template: an element or a component instance. */
interface RefBinding {
  id: number;
  /** The `data-meeko` number of an element ref; a component ref has none. */
  element?: number;
  name: string;
  /** Start of the name in the attribute value. */
  offset: number;
  /** Inside an each:of row, so the ref collects every row's target in list order. */
  list: boolean;
  target:
    | { kind: "element"; tag: string; svg: boolean; /** Union of the literal tags of `<component is>`. */ tagType?: string }
    | { kind: "component"; reference: string; referenceOffset: number }
    /** `<component is>` whose expression may be a tag or a component. */
    | { kind: "dynamic"; reference: string; referenceOffset: number };
}

/**
 * `bind="obj"` on an element: the object's keys become attributes. `excluded` are the attributes the
 * element sets itself, which win; `explicit` its `class` and `style`, which the spread combines.
 */
interface SpreadBinding {
  /** The `data-meeko` number of the element. */
  id: number;
  expression: string;
  offset: number;
  /** Code of the tag: a string literal, or the variable of the tag of `<component is>`. */
  tag: string;
  excluded: readonly string[];
  explicit: { class?: SpreadPart; style?: SpreadPart };
  /** `<component is>`: keys that the current tag does not accept are left out. */
  filtered: boolean;
}

/**
 * An explicit `class` or `style` combined with a spread: static code, or an expression at its offset.
 * `fixed` is the code of the static text written beside that expression, which join into one value.
 */
type SpreadPart = { code: string } | { expression: string; offset: number; fixed?: string };

/**
 * `<component is>` whose expression is always an HTML tag: an element whose tag changes. Its
 * children belong to the template around it; `bindings` are the element's own (attributes, events,
 * `ref:`, `html`, `bind`), which a new tag hydrates again.
 */
interface TagBinding {
  element: number;
  reference: string;
  referenceOffset: number;
  /** Name of the variable that holds the tag in the generated callbacks. */
  tagVariable: string;
  content: boolean;
  /** SSR code of the opening tag, which reads `tagVariable`. */
  open: string;
  bindings: TemplateBindings;
  offset: number;
  /** The branch of HTML tags of an `is` with component names: its tags, the names of the other branches and the tag that stands for them. */
  branch?: { tags: readonly string[]; names: readonly string[]; fallback: string };
}

/**
 * `<component is>` whose expression may be a tag or a component, between component markers. The
 * children are the component's snippets; the element renders the `default` one as its content.
 */
interface DynamicBinding extends TagBinding {
  /** Id of the component region. */
  id: number;
  svg: boolean;
  component: ComponentBinding;
  /** `<render>` region of the element's content: the `default` snippet. */
  contentRegion?: number;
  /** Attributes that only a tag, or only a component, has: `meeko check` needs `is` to be of that kind. */
  checks: Array<{ feature: string; kind: "tag" | "component"; offset: number; length: number }>;
}

interface ComponentBinding {
  id: number;
  reference: string;
  referenceOffset: number;
  /** Source length of the reference when it is not the source text: `<MeekoOutlet>` renders `__meeko_outlet_props.outlet`, `<MeekoThemeToggle>` `__meeko_MeekoThemeToggle`. */
  referenceLength?: number;
  /**
   * `attribute` is the source spelling, `bind:onSave`, `on:save` or `variant`; `name` is the prop.
   * `literal` marks a static attribute, whose `expression` is the quoted text or `true`.
   */
  props: Array<{ name: string; nameOffset: number; nameLength: number; attribute: string; expression: string; offset: number; literal?: true }>;
  /** `model="signal"` (the model `default`) and `model:name="signal"`. */
  models: Array<{ name: string; nameOffset: number; nameLength: number; expression: string; offset: number }>;
  /** Children of a component tag: loose content (`default`) and `<snippet name>` blocks. */
  snippets: SnippetBinding[];
  offset: number;
  /** Length of `<Name` or `<component`, where a missing required model or snippet is reported. */
  tagLength: number;
  ref?: RefBinding;
  /** `bind="obj"`: props from an object, before the explicit ones. */
  spread?: { expression: string; offset: number };
  /** A branch of `<component is>` with names: a prop that the component lacks may be another branch's. */
  branch?: true;
}

/** A `<snippet>` (or the loose content) that a parent passes to a component tag. */
interface SnippetBinding {
  /** Unique in the component, to name the signal of its arguments. */
  id: number;
  name: string;
  nameOffset: number;
  nameLength: number;
  params: string[];
  paramsOffset: number;
  paramsLength: number;
  /**
   * `if:when="expression"` (since 1.4): the parent passes the snippet only while the expression is
   * true. `attributeOffset` is the start of `if:when`, where MEEK110 reports a required snippet.
   */
  condition?: { expression: string; offset: number; attributeOffset: number };
  /**
   * `meeko check` only: references that the content of the snippet reads as truthy, such as
   * `items.data.value` inside `<MeekoAwait for="items">`, mapped to `length` characters at `offset`.
   */
  narrowing?: ReadonlyArray<{ expression: string; offset: number; length: number }>;
  render: string;
  bindings: TemplateBindings;
}

/** `<render snippet="expression" args="a, b" />` in the component that receives snippets. */
interface RenderBinding {
  id: number;
  snippet: string;
  snippetOffset: number;
  args?: string;
  argsOffset: number;
  offset: number;
}

/** `model="signal"` on a native form control. */
interface ModelBinding {
  id: number;
  kind: "text" | "checkbox" | "radio" | "select" | "multiple";
  expression: string;
  offset: number;
  /** Value of a radio: a static attribute (quoted code) or a `bind:value` expression. */
  radio?: { code: string } | { expression: string; offset: number };
}

/**
 * `html="expression"` on an element: the expression's HTML is the element's whole content, not
 * escaped. Unsafe with untrusted content; see {@link htmlDirective}.
 */
interface HtmlBinding {
  id: number;
  expression: string;
  offset: number;
}

interface TemplateBindings {
  texts: DynamicText[];
  htmls: HtmlBinding[];
  events: EventBinding[];
  attributes: AttributeBinding[];
  components: ComponentBinding[];
  /** Element refs; component refs live on their ComponentBinding. */
  refs: RefBinding[];
  models: ModelBinding[];
  renders: RenderBinding[];
  regions: Array<ConditionBinding | ListBinding | TeleportBinding>;
  spreads: SpreadBinding[];
  tags: TagBinding[];
  dynamics: DynamicBinding[];
}

interface TemplateContext {
  source: string;
  filename: string;
  templateOffset: number;
  scopeAttribute: string | undefined;
  /** Elements that receive `scopeAttribute`: those that a scoped selector may match. */
  scopeTargets: ScopeTargets;
  nextText: number;
  nextRegion: number;
  nextRef: number;
  nextHtml: number;
  /** Next `data-meeko="N"` of an element with bindings. */
  nextElement: number;
  /** Depth of each:of rows around the node being compiled. */
  listDepth: number;
  /** Every ref of the template, by name, to type them and reject duplicates. */
  refs: Map<string, RefBinding>;
  /** Refs that the script reads; only these are bound when the component hydrates. */
  usedRefs: ReadonlySet<string>;
  nextSnippet: number;
  /** Depth of `<snippet>` content around the node being compiled. */
  snippetDepth: number;
  /** `model` of the `<select>` whose options are being compiled. */
  selectModel: { expression: string; offset: number } | undefined;
  /** Compiled for `meeko check`: the content of an `if:when` is checked behind its condition. */
  narrow: boolean;
  /** `if:when` conditions around the node being compiled, when `narrow`. */
  guards: Guard[];
  /** Meeko's own tags that a component of the project replaces; see {@link shadowedBuiltinTags}. */
  shadowedTags: ReadonlySet<string>;
  /** Offset of the first tag of each replaced built-in, for its MEEK106 warning. */
  shadowedUses: Map<string, number>;
  /** Offset of the first tag of each deprecated built-in, for its MEEK121 warning. */
  deprecatedUses: Map<string, number>;
  /** Offset of each `each:*` or `if:*` attribute that no directive reads, for its MEEK119 warning. */
  strayDirectives: Map<number, { readonly name: string; readonly directive: "if:when" | "each:of" }>;
  /** Offset of each static attribute that its own `bind:` directive replaces, for its MEEK133 warning. */
  replacedAttributes: Map<number, string>;
  /** `theme` of the project, when the caller knows it; see {@link CompileOptions.theme}. */
  theme: boolean | undefined;
  /**
   * Names that are certainly components: imports of `.meeko` modules and the project's autoimported
   * PascalCase names. `<component is>` with one of them compiles as before, without a tag branch.
   */
  knownComponents: ReadonlySet<string>;
  /**
   * Names that a string literal of `is` may give (since 1.8): `knownComponents` and the values the
   * script declares. `complete` when the caller passed the project's autoimports, so any other
   * name is MEEK132.
   */
  componentNames: { readonly names: ReadonlySet<string>; readonly complete: boolean };
  /** Component tags that are a branch of `<component is>` with names, checked by `branchTag`. */
  branchComponents: WeakSet<TemplateNode>;
  /** Built-in components of {@link builtinComponentModules} that the template uses. */
  builtinModules: Set<string>;
  /** Text expressions whose character references change their length; their marks use decoded positions. */
  decodedRegions: DecodedRegion[];
}

function emptyBindings(): TemplateBindings {
  return { texts: [], htmls: [], events: [], attributes: [], components: [], refs: [], models: [], renders: [], regions: [], spreads: [], tags: [], dynamics: [] };
}

const voidElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/** `<MeekoOutlet />`: the layout or page inside app.meeko and the layouts. */
const outletTag = "MeekoOutlet";
/** What `<MeekoOutlet />` renders: the `outlet` prop, through an alias that the setup declares. */
const outletReference = "__meeko_outlet_props.outlet";

/** `<MeekoLink>`: an `<a>` whose `href` comes from the typed `href()`. */
const linkTag = "MeekoLink";

/** `<MeekoThemeToggle>`: the theme switch of `theme`, a component that Meeko compiles and ships. */
const themeToggleTag = "MeekoThemeToggle";

/** `<MeekoAwait for="items">`: the zone of data that loads after the first paint, a component that Meeko compiles and ships. */
const awaitTag = "MeekoAwait";

/** `<MeekoTeleport to="#id">` (since 1.5): its content renders in another place of the document. */
const teleportTag = "MeekoTeleport";

/** A built-in component that ships as a module of its own, `@meekojs/meeko/builtins/<name>`. */
export interface BuiltinComponentModule {
  /** Canonical component source; the build emits the public module from this file. */
  readonly source: string;
  /** Specifier of its compiled module, which only the components that use the tag import. */
  readonly specifier: string;
  /** Name of the namespace import in the generated module. */
  readonly alias: string;
}

/**
 * Meeko's own components that live in a module of their own (`<MeekoThemeToggle>` since 1.4,
 * `<MeekoAwait>`, `<MeekoPopover>` and `<MeekoSelect>` since 1.5): a compiled component imports
 * that module only when its template uses the tag, so an application that never writes them does
 * not carry their code. Sources live under `app/components`; generated modules keep the public
 * `builtins` paths.
 */
export const builtinComponentModules: Readonly<Record<string, BuiltinComponentModule>> = {
  MeekoThemeToggle: { source: "src/app/components/MeekoThemeToggle/MeekoThemeToggle.meeko", specifier: "@meekojs/meeko/builtins/theme-toggle", alias: "__meeko_MeekoThemeToggle" },
  MeekoAwait: { source: "src/app/components/MeekoAwait/MeekoAwait.meeko", specifier: "@meekojs/meeko/builtins/await", alias: "__meeko_MeekoAwait" },
  MeekoPopover: { source: "src/app/components/MeekoPopover/MeekoPopover.meeko", specifier: "@meekojs/meeko/builtins/popover", alias: "__meeko_MeekoPopover" },
  MeekoSelect: { source: "src/app/components/MeekoSelect/MeekoSelect.meeko", specifier: "@meekojs/meeko/builtins/select", alias: "__meeko_MeekoSelect" },
};

/**
 * `<MeekoLink>` as a component of its own (since 1.8), for `resolveComponent("MeekoLink")` and the
 * component registry. The tag and `'MeekoLink'` in `is` compile inline and never import it.
 */
export const linkComponentModule: BuiltinComponentModule = { source: "src/app/components/MeekoLink/MeekoLink.meeko", specifier: "@meekojs/meeko/builtins/link", alias: "__meeko_MeekoLink" };

/**
 * Meeko's own tags (`MeekoLink` and `MeekoOutlet` since 1.2, `MeekoThemeToggle` since 1.4,
 * `MeekoTeleport`, `MeekoAwait`, `MeekoPopover` and `MeekoSelect` since 1.5), which a project may
 * already use as the names of its components.
 */
const builtinTags: readonly string[] = [linkTag, outletTag, teleportTag, ...Object.keys(builtinComponentModules)];

/**
 * Meeko's own tags deprecated since 1.8 and their replacement in `@meekojs/ui`, for the MEEK121
 * warning. They keep working through 1.x and leave the core in 2.0.
 */
export const deprecatedBuiltinTags: Readonly<Record<string, string>> = {
  MeekoPopover: "UIPopover",
  MeekoSelect: "UISelect",
  MeekoThemeToggle: "UIThemeToggle",
};

/** What each built-in tag is, for the MEEK106 warning of a project component with its name. */
const builtinDescriptions: Readonly<Record<string, string>> = {
  [linkTag]: "un enlace con href tipado y aria-current",
  [outletTag]: "la página o el layout de dentro",
  [themeToggleTag]: "el selector del tema de theme",
  [awaitTag]: "la zona de datos que cargan después del primer pintado",
  [teleportTag]: "su contenido en otro lugar del documento",
  MeekoPopover: "un popover anclado con la API popover",
  MeekoSelect: "un select accesible sobre <MeekoPopover>",
};

/**
 * The references that `<MeekoAwait for="…">` waits for, as written: `items` or each element of
 * `[items, stats]`, when it is a plain reference (`a`, `a.b`). Inside its content, `meeko check`
 * and the editor read `<reference>.data.value` as loaded. Anything else is not narrowed.
 */
export function awaitForReferences(expression: string): Array<{ text: string; start: number }> {
  const file = ts.createSourceFile("for.ts", `(${expression})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statement = file.statements[0];
  if (!statement || !ts.isExpressionStatement(statement)) return [];
  let value: ts.Expression = statement.expression;
  while (ts.isParenthesizedExpression(value)) value = value.expression;
  const elements = ts.isArrayLiteralExpression(value) ? [...value.elements] : [value];
  const plain = (node: ts.Node): boolean => ts.isIdentifier(node) || (ts.isPropertyAccessExpression(node) && !node.questionDotToken && ts.isIdentifier(node.name) && plain(node.expression));
  return elements.filter(plain).map((node) => ({ text: node.getText(file), start: node.getStart(file) - 1 }));
}

/**
 * Meeko's own tags that a component of the project replaces: one that the script imports or declares
 * at its top level, or one of `projectComponents` (the names that the project autoimports). The
 * project's component wins, so a component named `MeekoLink`, `MeekoOutlet` or `MeekoThemeToggle`
 * from before the built-in tag keeps working.
 */
export function shadowedBuiltinTags(script: string, projectComponents: Iterable<string> = []): Set<string> {
  const shadowed = new Set<string>();
  for (const name of projectComponents) if (builtinTags.includes(name)) shadowed.add(name);
  if (!builtinTags.some((tag) => script.includes(tag))) return shadowed;
  const file = ts.createSourceFile("script.ts", script, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const declared: ts.Identifier[] = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (clause.name) declared.push(clause.name);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) declared.push(bindings.name);
      else if (bindings) for (const element of bindings.elements) if (!element.isTypeOnly) declared.push(element.name);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) bindingIdentifiers(declaration.name, declared);
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      declared.push(statement.name);
    }
  }
  for (const identifier of declared) if (builtinTags.includes(identifier.text)) shadowed.add(identifier.text);
  return shadowed;
}

/**
 * Whether `name` is an `aria-*` or `data-*` attribute that a component tag passes as a prop of
 * that name (since 1.8), such as `aria-label` or `data-state`. In lowercase, like HTML writes them;
 * `data-meeko*` is reserved to Meeko (MEEK032).
 */
function attributePropName(name: string, offset: number, context: TemplateContext): boolean {
  if (!/^(?:aria|data)-[a-z0-9][a-z0-9._-]*$/i.test(name)) return false;
  if (name !== name.toLowerCase()) {
    throw compileError(context.source, context.filename, "MEEK032", `${name} se escribe en minúsculas, como en HTML: ${name.toLowerCase()}`, offset);
  }
  if (name.startsWith("data-meeko")) {
    throw compileError(context.source, context.filename, "MEEK032", `${name} está reservado a Meeko: usa otro nombre de data-*`, offset);
  }
  return true;
}

/**
 * Whether `<component is>` with a value decided at run time also passes this attribute as a prop to
 * a component, as its tag does: an `aria-*` or `data-*`, in lowercase and not reserved to Meeko.
 */
function isAttributeProp(name: string): boolean {
  return /^(?:aria|data)-[a-z0-9][a-z0-9._-]*$/.test(name) && !name.startsWith("data-meeko");
}

/** A source expression of `<MeekoLink>`: `to`, `params`, `search` or `match`, at its offset. */
interface LinkPart {
  expression: string;
  offset: number;
  /** The text of a static `to="/about"`. */
  literal?: string;
}

/**
 * The parts of `<MeekoLink>` that build its `href`, and `match`, which sets when it is current.
 * `resolve` (since 1.8) skips the application's link resolvers; `hreflang` stays an attribute of
 * the `<a>` and is also passed to them. `current` is an `aria-current` of its own, which wins over
 * the route: `aria-current` always has one writer, or SSR and hydration disagree.
 */
interface LinkParts {
  to: LinkPart;
  params?: LinkPart;
  search?: LinkPart;
  match?: LinkPart;
  resolve?: LinkPart;
  hreflang?: LinkPart;
  current?: LinkPart;
}

/**
 * `<MeekoLink to="/users/[id]" bind:params="…" bind:search="…" class="…">` as the `<a>` it renders:
 * `to`, `params` and `search` build the href and `match="prefix"` (or `bind:match`) also marks it
 * current below its route; every other attribute and the children stay on the `<a>`, so `class`,
 * `target`, `aria-*`, `data-*` and `on:click` work as on any link.
 */
function linkElement(node: TemplateNode, context: TemplateContext): { node: TemplateNode; link: LinkParts } {
  const parts: Partial<LinkParts> = {};
  const rest: NonNullable<TemplateNode["attrs"]> = [];
  for (const attribute of node.attrs ?? []) {
    const rawName = /^[^\s=]+/.exec(context.source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name;
    const key = rawName === "to" || rawName === "bind:to" ? "to"
      : rawName === "bind:params" ? "params"
      : rawName === "bind:search" ? "search"
      : rawName === "match" || rawName === "bind:match" ? "match"
      : rawName === "bind:resolve" ? "resolve"
      : undefined;
    if (rawName === "href" || rawName === "bind:href") {
      throw compileError(context.source, context.filename, "MEEK105", "<MeekoLink> construye su href: indica la ruta con to=\"/users/[id]\" y sus parámetros con bind:params", attribute.start);
    }
    if (rawName === "params" || rawName === "search") {
      throw compileError(context.source, context.filename, "MEEK105", `${rawName} de <MeekoLink> es un objeto: escríbelo como bind:${rawName}="{ … }"`, attribute.start);
    }
    if (rawName === "resolve") {
      throw compileError(context.source, context.filename, "MEEK105", "resolve de <MeekoLink> es un booleano: escríbelo como bind:resolve=\"false\"", attribute.start);
    }
    if (rawName === "hreflang" || rawName === "bind:hreflang") {
      // An attribute of the `<a>` that the application's link resolvers also read.
      if (rawName === "hreflang") parts.hreflang = { expression: quote(attribute.value), offset: attribute.start, literal: attribute.value };
      else {
        const offset = attributeValueOffset(node, attribute.name, context);
        validateExpression(attribute.value, context.source, context.filename, offset);
        parts.hreflang = { expression: attribute.value, offset };
      }
      rest.push(attribute);
      continue;
    }
    if (attribute.name === "aria-current" || attribute.name === "bind:aria-current") {
      // An attribute of the `<a>` that replaces the route's: it stays visible to scoped styles.
      if (parts.current) throw compileError(context.source, context.filename, "MEEK105", "<MeekoLink> recibe aria-current dos veces; deja uno", attribute.start);
      if (attribute.name === "aria-current") parts.current = { expression: quote(attribute.value), offset: attribute.start, literal: attribute.value };
      else {
        const offset = attributeValueOffset(node, attribute.name, context);
        validateExpression(attribute.value, context.source, context.filename, offset);
        parts.current = { expression: attribute.value, offset };
      }
      rest.push(attribute);
      continue;
    }
    if (!key) { rest.push(attribute); continue; }
    if (parts[key]) throw compileError(context.source, context.filename, "MEEK105", `<MeekoLink> recibe ${key} dos veces; deja uno`, attribute.start);
    if (rawName === "to") {
      // `to="/users/[id]"`: the route ID as a string literal, mapped with its quotes as a static prop.
      const valueStart = attributeValueStart(context.source, attribute);
      if (valueStart === undefined || !attribute.value) throw compileError(context.source, context.filename, "MEEK105", "to de <MeekoLink> necesita la ruta, como to=\"/users/[id]\"", attribute.start);
      const quoted = /["']/.test(context.source[valueStart - 1] ?? "");
      parts.to = { expression: quote(attribute.value), offset: quoted ? valueStart - 1 : valueStart, literal: attribute.value };
      continue;
    }
    if (rawName === "match") {
      // `match="prefix"`: a fixed choice, checked here; `bind:match` is checked by its type.
      const valueStart = attributeValueStart(context.source, attribute);
      if (valueStart === undefined || (attribute.value !== "exact" && attribute.value !== "prefix")) {
        throw compileError(context.source, context.filename, "MEEK105", "match de <MeekoLink> es \"exact\" (por defecto) o \"prefix\", como match=\"prefix\"", attribute.start);
      }
      const quoted = /["']/.test(context.source[valueStart - 1] ?? "");
      parts.match = { expression: quote(attribute.value), offset: quoted ? valueStart - 1 : valueStart, literal: attribute.value };
      continue;
    }
    const offset = attributeValueOffset(node, attribute.name, context);
    validateExpression(attribute.value, context.source, context.filename, offset);
    parts[key] = { expression: attribute.value, offset };
  }
  if (!parts.to) throw compileError(context.source, context.filename, "MEEK105", "<MeekoLink> necesita to con la ruta, como <MeekoLink to=\"/users/[id]\">", node.start);
  const { componentName: _componentName, selfClosing: _selfClosing, ...element } = node;
  return { node: { ...element, nodeName: "a", tagName: "a", attrs: rest }, link: parts as LinkParts };
}

/** app/app.meeko, a layout of app/layouts or a +layout.meeko: the components Meeko gives an outlet. */
function isOutletHost(filename: string): boolean {
  const path = filename.replaceAll("\\", "/");
  return /\/app\/app\.meeko$/.test(path) || /\/app\/layouts\/.+\.meeko$/.test(path) || /\/\+layout\.meeko$/.test(path);
}

/** A static `to` of `<MeekoTeleport>`: `body` or `#id`, as `isTeleportTarget` of the runtime admits. */
const teleportTarget = /^(?:body|#[A-Za-z][A-Za-z0-9_-]*)$/;

/**
 * `<MeekoTeleport to="#toolbar" bind:disabled="…">…</MeekoTeleport>`: the content is compiled in
 * this template, with its scope, bindings and `<style scoped>` attribute, and renders through
 * `renderTeleport`, which places it in the target. `to` (or `bind:to`) is required; `disabled` (a
 * bare attribute) or `bind:disabled` keep it in its place.
 */
function teleportRegion(node: TemplateNode, bindings: TemplateBindings, context: TemplateContext): string {
  const fail = (message: string, offset: number): never => { throw compileError(context.source, context.filename, "MEEK114", message, offset); };
  let to: { expression: string; offset: number } | undefined;
  let disabled: TeleportBinding["disabled"];
  for (const attribute of node.attrs ?? []) {
    const rawName = /^[^\s=]+/.exec(context.source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name;
    if (rawName === "to" || rawName === "bind:to") {
      if (to) fail("<MeekoTeleport> recibe to dos veces; deja uno", attribute.start);
      if (rawName === "to") {
        const valueStart = attributeValueStart(context.source, attribute);
        if (valueStart === undefined || !teleportTarget.test(attribute.value)) {
          fail(`to de <MeekoTeleport> admite "body" o "#id" (una letra y luego letras, dígitos, - o _), como to="#toolbar"${attribute.value ? `, no "${attribute.value}"` : ""}`, attribute.value ? valueStart! : attribute.start);
        }
        const quoted = /["']/.test(context.source[valueStart! - 1] ?? "");
        to = { expression: quote(attribute.value), offset: quoted ? valueStart! - 1 : valueStart! };
      } else {
        if (!attribute.value.trim()) fail("bind:to de <MeekoTeleport> necesita una expresión, como bind:to=\"target.value\"", attribute.start);
        const offset = attributeValueOffset(node, attribute.name, context);
        validateExpression(attribute.value, context.source, context.filename, offset);
        to = { expression: attribute.value, offset };
      }
    } else if (rawName === "disabled" || rawName === "bind:disabled") {
      if (disabled) fail("<MeekoTeleport> recibe disabled dos veces; deja uno", attribute.start);
      if (rawName === "disabled") {
        if (attributeValueStart(context.source, attribute) !== undefined) fail("disabled de <MeekoTeleport> no lleva valor; escribe disabled o bind:disabled=\"expression\"", attribute.start);
        disabled = { expression: "true", offset: attribute.start, length: rawName.length, literal: true };
      } else {
        if (!attribute.value.trim()) fail("bind:disabled de <MeekoTeleport> necesita una expresión, como bind:disabled=\"isMobile.value\"", attribute.start);
        const offset = attributeValueOffset(node, attribute.name, context);
        validateExpression(attribute.value, context.source, context.filename, offset);
        disabled = { expression: attribute.value, offset, length: attribute.value.length };
      }
    } else {
      fail(`<MeekoTeleport> admite to, bind:to, disabled, bind:disabled, if:when y each:of; ${rawName} no se admite`, attribute.start);
    }
  }
  if (!to) fail("<MeekoTeleport> necesita to con su destino, como <MeekoTeleport to=\"#toolbar\"> o to=\"body\"", node.start);
  const inner = emptyBindings();
  // The content is a function: it is checked behind the `if:when` conditions around the tag too.
  const content = narrowed((node.childNodes ?? []).map((child) => renderNode(child, inner, context)).join(" + ") || quote(""), context.guards);
  const id = context.nextRegion++;
  bindings.regions.push({ kind: "teleport", id, expression: to!.expression, offset: to!.offset, ...(disabled ? { disabled } : {}), render: content, bindings: inner });
  const disabledCode = disabled ? markSource(disabled.expression, disabled.offset, disabled.length) : "false";
  return `__meeko.renderTeleport(${id}, ${markSource(to!.expression, to!.offset)}, ${disabledCode}, () => ${content})`;
}

/** Elements whose content is not parsed as HTML, so `html` cannot fill them. */
const rawTextElements = new Set(["textarea", "title", "script", "style", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"]);

/** Resultado del compilador de un componente .meeko. */
export interface CompileResult {
  code: string;
  css: string;
  mappings: readonly SourceMapping[];
  /**
   * Avisos que no impiden compilar, como una prop que el setup lee una sola vez (MEEK101).
   * @since 1.2.0
   */
  warnings?: readonly CompileDiagnostic[];
}

/** Opciones de generación; HMR se incluye solo en módulos de desarrollo. */
export interface CompileOptions {
  hot?: boolean;
  /**
   * Módulo para `meeko check`, que nunca se ejecuta: el contenido de un `if:when` se comprueba
   * tras su condición, que estrecha sus tipos.
   */
  typeCheck?: boolean;
  /**
   * Elementos que reciben el atributo de `<style scoped>`: `"all"` (por defecto en 1.x), todos los
   * de la plantilla; `"matched"`, sólo los que algún selector con ámbito puede seleccionar. Es el
   * `css.scopeAttribute` de `meeko.config.ts`.
   */
  scopeAttribute?: "all" | "matched";
  /**
   * Nombres que el proyecto autoimporta. Un componente llamado `MeekoLink`, `MeekoOutlet`,
   * `MeekoThemeToggle`, `MeekoAwait` o `MeekoTeleport` tiene prioridad sobre la etiqueta propia de Meeko, con el aviso MEEK106.
   */
  projectComponents?: Iterable<string>;
  /**
   * Si el proyecto tiene `theme` en `meeko.config.ts`. Con `false`, `<MeekoThemeToggle>` es el error
   * MEEK111; sin la opción (quien compila no conoce la configuración) se compila, y el runtime da el
   * mismo error si falta `theme`.
   * @since 1.4.0
   */
  theme?: boolean;
  /**
   * Módulo del que se exporta `css` cuando el CSS del componente pasa por otra herramienta, como
   * el PostCSS de Vite. Recibe el CSS que genera el compilador, con el ámbito ya aplicado, y
   * devuelve el especificador de un módulo cuyo export por defecto es ese CSS procesado. Con
   * `undefined`, o sin CSS, `css` es la cadena del compilador, y también cuando el módulo exporta
   * una cadena vacía, como en un host que no procesa CSS (Vitest sin `css: true`). El plugin de Vite de Meeko lo usa
   * en el grafo SSR y en desarrollo, para que el SSR y el prerender incrusten el CSS ya procesado y
   * la HMR lo vuelva a aplicar; en el build de cliente de producción no lo pasa.
   *
   * @example
   * ```ts
   * compile(source, "Card.meeko", { styleModule: (css) => `/Card.meeko?style=${hash(css)}&inline&lang.css` })
   * ```
   * @since 1.8.0
   */
  styleModule?: (css: string) => string | undefined;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function attributeValueOffset(node: TemplateNode, name: string, context: TemplateContext): number {
  const position = node.sourceCodeLocation?.attrs?.[name];
  if (!position) return context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0);
  const start = context.templateOffset + position.startOffset;
  return attributeValueStart(context.source, { start, end: context.templateOffset + position.endOffset }) ?? start;
}

/**
 * Static attributes of a component tag that are not props: `is` names the component of
 * `<component>` and `ref="x"` is reserved next to the `ref:name` directive (MEEK032, as in 1.0).
 */
// `html` is the raw-HTML directive on elements; on a component it is never a static prop.
const reservedStaticProps = new Set(["is", "ref", "html"]);

/**
 * The static `class` and `style` of an element that also has their `bind:` directive, by name:
 * both write a single attribute that joins the static value and the dynamic one (since 1.8;
 * before, SSR wrote the attribute twice and hydration failed).
 */
function joinedAttributes(node: TemplateNode): Map<string, string> {
  const joined = new Map<string, string>();
  for (const name of ["class", "style"]) {
    const fixed = node.attrs?.find((attribute) => attribute.name === name);
    if (fixed && node.attrs?.some((attribute) => attribute.name === `bind:${name}`)) joined.set(name, fixed.value);
  }
  return joined;
}

/**
 * Names of the attributes a tag writes with `bind:`, as `attributeName` spells them. The same name as
 * static text is MEEK133, except `class` and `style`, which are never in conflict: they join.
 */
function boundAttributeNames(node: TemplateNode, attributeName: (name: string) => string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const attribute of node.attrs ?? []) {
    if (!attribute.name.startsWith("bind:")) continue;
    const name = attributeName(attribute.name.slice(5));
    if (name !== "class" && name !== "style") names.add(name);
  }
  return names;
}

/** Whether an attribute is a `ref:name` directive. */
function isRefDirective(attribute: { name: string }): boolean {
  return attribute.name.startsWith("ref:");
}

/**
 * `ref:name` names an element or a component instance for `useElementRef("name")`. It takes no
 * value, and a name marks one place of the template; inside each:of it names every row.
 * `ref="x"` and `bind:ref` are not directives: they stay a plain attribute or prop, as in 1.0.
 */
function templateRef(node: TemplateNode, context: TemplateContext, target: RefBinding["target"]): RefBinding | undefined {
  const directives = (node.attrs ?? []).filter(isRefDirective);
  const attribute = directives[0];
  if (!attribute) return undefined;
  if (context.snippetDepth > 0) {
    throw compileError(context.source, context.filename, "MEEK052", "ref: no se admite dentro del contenido de <snippet>, que el hijo puede renderizar cualquier número de veces", attribute.start);
  }
  if (directives.length > 1) {
    throw compileError(context.source, context.filename, "MEEK052", "Un elemento o componente admite una sola directiva ref:", directives[1]!.start);
  }
  // parse5 lowercases attribute names; the source keeps the case of the ref name.
  const raw = context.source.slice(attribute.start, attribute.end);
  const rawName = /^[^\s=]+/.exec(raw)?.[0] ?? attribute.name;
  const name = rawName.slice(4);
  if (raw.length > rawName.length) {
    throw compileError(context.source, context.filename, "MEEK052", `ref:${name} no lleva valor; escribe ref:${name || "name"}`, attribute.start);
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    throw compileError(context.source, context.filename, "MEEK052", `Nombre de ref no válido: "${name}"; usa un identificador, como ref:input`, attribute.start);
  }
  const offset = attribute.start + 4;
  const previous = context.refs.get(name);
  if (previous) {
    const point = locate(context.source, previous.offset);
    throw compileError(context.source, context.filename, "MEEK053", `ref:${name} ya se usa en la línea ${point.line}; una ref nombra un solo lugar de la plantilla (las filas de each:of la comparten)`, offset);
  }
  const ref: RefBinding = { id: context.nextRef++, name, offset, list: context.listDepth > 0, target };
  context.refs.set(name, ref);
  return ref;
}

/** Source position of `position`, a decoded position inside a text expression of {@link TemplateContext.decodedRegions}. */
function decodedSourceOffset(context: TemplateContext, position: number): number {
  const region = context.decodedRegions.find(({ offset, decoded }) => position >= offset && position <= offset + decoded.text.length);
  return region ? region.offset + expressionSourceOffset(region.decoded, position - region.offset) : position;
}

/** `raw` is the source text of a text node, so every offset is a source position. */
function textParts(raw: string, bindings: TemplateBindings, context: TemplateContext, offset: number): string[] {
  const parts: string[] = [];
  const scan = scanInterpolations(raw);
  let cursor = 0;
  for (const segment of scan.segments) {
    const staticPart = decodeTemplateText(raw.slice(cursor, segment.start));
    if (staticPart) parts.push(`__meeko.escapeHtml(${quote(staticPart)})`);
    // Entities decode without markup: a `<` of the code (`{a<b&&c}`) never opens a tag.
    const decoded = decodeTemplateExpression(segment.expression);
    const expression = decoded.text;
    if (!expression) throw compileError(context.source, context.filename, "MEEK009", "Expresión de plantilla vacía", offset + segment.start);
    const expressionOffset = offset + segment.expressionStart;
    // `{{ expr }}` from Vue: the inner braces would read as an object literal.
    if (doubleBraces(expression)) throw compileError(context.source, context.filename, "MEEK020", doubleBracesMessage, offset + segment.start);
    validateExpression(expression, context.source, context.filename, expressionOffset, (position) => expressionSourceOffset(decoded, position));
    if (decoded.pieces.length > 1) context.decodedRegions.push({ offset: expressionOffset, decoded });
    const id = context.nextText++;
    bindings.texts.push({ id, expression, offset: expressionOffset });
    parts.push(`${quote(`<!--meeko:text:${id}-->`)} + __meeko.escapeHtml(${markSource(expression, expressionOffset)}) + ${quote(`<!--/meeko:text:${id}-->`)}`);
    cursor = segment.end;
  }
  if (scan.unterminated !== undefined) throw compileError(context.source, context.filename, "MEEK010", "Expresión de plantilla sin cerrar", offset + scan.unterminated);
  const tail = decodeTemplateText(raw.slice(cursor));
  if (tail) parts.push(`__meeko.escapeHtml(${quote(tail)})`);
  return parts;
}

function renderNode(node: TemplateNode, bindings: TemplateBindings, context: TemplateContext): string {
  if (node.nodeName === "#text") {
    return textParts(context.source.slice(node.start, node.end), bindings, context, node.start).join(" + ") || quote("");
  }
  if (node.nodeName === "#comment") return quote(`<!--${node.value ?? ""}-->`);
  if (!node.tagName) return (node.childNodes ?? []).map((child) => renderNode(child, bindings, context)).join(" + ") || quote("");

  const attrsList = node.attrs ?? [];
  const position = context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0);
  const condition = attrsList.find((attribute) => attribute.name === "if:when");
  const list = attrsList.find((attribute) => attribute.name === "each:of");
  if (condition && list) throw compileError(context.source, context.filename, "MEEK021", "Un nodo no puede tener if:when y each:of a la vez", position);
  if (condition || list) {
    const inner = emptyBindings();
    const excluded = new Set(condition ? ["if:when"] : ["each:of", "each:as", "each:key", "each:index"]);
    // MEEK119: `each:by`, `if:else`… read by no directive stay a literal attribute; a warning, since 1.7.
    for (const attribute of attrsList) {
      if (!excluded.has(attribute.name) && /^(?:each|if):/.test(attribute.name)) {
        context.strayDirectives.set(attribute.start, { name: attribute.name, directive: condition ? "if:when" : "each:of" });
      }
    }
    const clone: TemplateNode = { ...node, attrs: attrsList.filter((attribute) => !excluded.has(attribute.name)) };
    const itemName = attrsList.find((attribute) => attribute.name === "each:as")?.value;
    const key = attrsList.find((attribute) => attribute.name === "each:key")?.value;
    const indexName = attrsList.find((attribute) => attribute.name === "each:index")?.value ?? "index";
    // The content of a condition is checked behind it; a row's item and index shadow outer names.
    const outerGuards = context.guards;
    const guards = !context.narrow ? outerGuards
      : condition ? [...outerGuards, { code: markSource(condition.value, attributeValueOffset(node, "if:when", context)), names: namesOf(condition.value) }]
      : unshadowed(outerGuards, [itemName, indexName]);
    if (list) context.listDepth++;
    context.guards = guards;
    let html: string;
    try { html = narrowed(renderNodeContent(clone, inner, context), guards); }
    finally {
      if (list) context.listDepth--;
      context.guards = outerGuards;
    }
    const id = context.nextRegion++;
    if (condition) {
      const offset = attributeValueOffset(node, "if:when", context);
      validateExpression(condition.value, context.source, context.filename, offset);
      bindings.regions.push({ kind: "condition", id, expression: condition.value, offset, render: html, bindings: inner });
      return `__meeko.renderIf(${id}, ${markSource(condition.value, offset)}, () => ${html})`;
    }
    if (!itemName || !/^[a-zA-Z_$][\w$]*$/.test(itemName) || itemName.startsWith("__") || !/^[a-zA-Z_$][\w$]*$/.test(indexName) || indexName.startsWith("__") || itemName === indexName) {
      throw compileError(context.source, context.filename, "MEEK022", "Una lista necesita identificadores válidos y distintos en each:as y each:index", position);
    }
    const offset = attributeValueOffset(node, "each:of", context);
    validateExpression(list!.value, context.source, context.filename, offset);
    // Without each:key the index is the key: row i always shows item i, and rows are only added or removed at the end.
    let keyOf = "__meeko.indexKey";
    let keyEntry: Pick<ListBinding, "key" | "keyOffset"> | undefined;
    if (key !== undefined) {
      const keyOffset = attributeValueOffset(node, "each:key", context);
      validateExpression(key, context.source, context.filename, keyOffset);
      keyEntry = { key, keyOffset };
      keyOf = `(${itemName}, ${indexName}) => ${markSource(`(${narrowed(markSource(key, keyOffset), guards)})`, keyOffset, key.length)}`;
    }
    bindings.regions.push({ kind: "list", id, expression: list!.value, offset, ...keyEntry, itemName, indexName, render: html, bindings: inner });
    return `__meeko.renderFor(${id}, ${markSource(list!.value, offset)}, ${keyOf}, (${itemName}, ${indexName}) => ${html})`;
  }
  if (attrsList.some((attribute) => attribute.name.startsWith("each:") || attribute.name.startsWith("if:"))) {
    throw compileError(context.source, context.filename, "MEEK024", "Directiva de plantilla incompleta", position);
  }
  return renderNodeContent(node, bindings, context);
}

function renderNodeContent(node: TemplateNode, bindings: TemplateBindings, context: TemplateContext): string {
  if (node.tagName === "template") {
    const ref = node.attrs?.find(isRefDirective);
    if (ref) throw compileError(context.source, context.filename, "MEEK052", "ref: no se admite en <template>; ponla en un elemento o en un componente", ref.start);
    const html = node.attrs?.find((attribute) => attribute.name === "html");
    if (html) throw compileError(context.source, context.filename, "MEEK095", "html no se admite en <template>; ponlo en un elemento, como <div html=\"content\"></div>", html.start);
    const spread = node.attrs?.find((attribute) => attribute.name === "bind");
    if (spread) throw compileError(context.source, context.filename, "MEEK113", "bind=\"…\" no se admite en <template>, que no es un elemento; ponlo en un elemento o en un componente", spread.start);
    return (node.content?.childNodes ?? []).map((child) => renderNode(child, bindings, context)).join(" + ") || quote("");
  }
  if (node.tagName === "snippet") {
    throw compileError(context.source, context.filename, "MEEK061", "<snippet> debe ser hijo directo de una etiqueta de componente, como <AppDialog><snippet name=\"title\">...</snippet></AppDialog>", node.start);
  }
  if (node.tagName === "render") return renderSnippetTag(node, bindings, context);
  // A component of the project with the name of a built-in tag is that component, as in 1.1.
  const shadowed = node.componentName !== undefined && context.shadowedTags.has(node.componentName);
  if (shadowed && !context.shadowedUses.has(node.componentName!)) context.shadowedUses.set(node.componentName!, node.start);
  if (!shadowed && node.componentName !== undefined && deprecatedBuiltinTags[node.componentName] && !context.deprecatedUses.has(node.componentName)) context.deprecatedUses.set(node.componentName, node.start);
  // `<MeekoTeleport to="#toolbar">` renders its content in another place of the document.
  if (node.componentName === teleportTag && !shadowed) return teleportRegion(node, bindings, context);
  // `<MeekoLink to="/users/[id]" bind:params="…">` is an `<a>` with a checked href.
  let link: LinkParts | undefined;
  if (node.componentName === linkTag && !shadowed) ({ node, link } = linkElement(node, context));
  const componentTag = node.componentName !== undefined;
  const outlet = node.componentName === outletTag && !shadowed;
  // `<MeekoThemeToggle>` is the component that Meeko ships, with the props and snippets of any tag.
  const themeToggle = node.componentName === themeToggleTag && !shadowed;
  // `<MeekoAwait for="items">` is one of them; `for` is an expression, as `bind:for`.
  const awaitZone = node.componentName === awaitTag && !shadowed;
  // `<MeekoThemeToggle>`, `<MeekoAwait>`, `<MeekoPopover>` and `<MeekoSelect>` are components that
  // Meeko ships, with the props and snippets of any tag, from a module that only this component imports.
  const shipped = shadowed || node.componentName === undefined ? undefined : builtinComponentModules[node.componentName];
  if (themeToggle && context.theme === false) {
    throw compileError(context.source, context.filename, "MEEK111", "<MeekoThemeToggle> sólo existe con theme en meeko.config.ts: añade theme: true (o sus opciones) para usarlo", node.start);
  }
  if (outlet) {
    if (!isOutletHost(context.filename)) {
      throw compileError(context.source, context.filename, "MEEK104", "<MeekoOutlet /> sólo se usa en app/app.meeko y en los layouts (app/layouts/*.meeko o +layout.meeko): pinta el layout o la página que van dentro", node.start);
    }
    if ((node.attrs ?? []).length || (node.childNodes ?? []).some((child) => child.nodeName !== "#text" || Boolean(child.value?.trim()))) {
      throw compileError(context.source, context.filename, "MEEK104", "<MeekoOutlet /> no admite atributos ni contenido: escríbelo como <MeekoOutlet />", node.start);
    }
  }
  if (node.tagName === "component" || componentTag) {
    const position = node.start;
    let reference: string;
    let referenceOffset: number;
    let snippets: SnippetBinding[] = [];
    if (outlet) {
      // The layout or page inside, from the `outlet` prop that Meeko passes to app.meeko and layouts.
      reference = outletReference;
      referenceOffset = node.start + 1;
    } else if (shipped) {
      reference = shipped.alias;
      referenceOffset = node.start + 1;
      context.builtinModules.add(node.componentName!);
      // `<MeekoAwait>` runs its content once the data is there: `meeko check` reads `items.data.value` as loaded.
      const forAttribute = awaitZone ? node.attrs?.find((attribute) => attribute.name === "for" || attribute.name === "bind:for") : undefined;
      const forOffset = forAttribute && attributeValueStart(context.source, forAttribute);
      const narrowing = forAttribute && forOffset !== undefined && context.narrow
        ? awaitForReferences(forAttribute.value).map((reference) => ({ expression: `${reference.text}.data.value`, offset: forOffset + reference.start, length: reference.text.length }))
        : [];
      snippets = componentSnippets(node, context, narrowing);
    } else if (componentTag) {
      // `<AppButton>` is `<component is="AppButton">`: the tag names an identifier of the script scope.
      reference = node.componentName!;
      referenceOffset = node.start + 1;
      // Children are snippets; a child without defineSnippets rejects them in the type check.
      snippets = componentSnippets(node, context);
    } else {
      const referenceAttribute = node.attrs?.find((attribute) => attribute.name === "is");
      reference = referenceAttribute?.value ?? "";
      if (!reference.trim()) throw compileError(context.source, context.filename, "MEEK030", "Un componente necesita is=\"expression\"", position);
      referenceOffset = attributeValueOffset(node, "is", context);
      validateExpression(reference, context.source, context.filename, referenceOffset);
      // Since 1.8 a PascalCase string literal names a component, such as `to ? 'MeekoLink' : 'a'`.
      const leaves = isLeaves(reference);
      if (leaves.some((leaf) => leaf.literal !== undefined && isComponentName(leaf.literal))) return renderNamedIs(node, bindings, context, reference, referenceOffset, leaves);
      // `is` may give an HTML tag: an element whose tag can change, or either kind at run time. A
      // result that is a PascalCase name or a `.meeko` import is a component, as before 1.5.
      const candidates = isCandidates(reference);
      const known = candidates.tags.length === 0 && candidates.others.every((other) => /^[A-Z][\w$]*$/.test(other.trim()) || context.knownComponents.has(other.trim()));
      if (!known) return renderDynamicTag(node, bindings, context, reference, referenceOffset, candidates.others.length === 0 ? candidates.tags : undefined);
      // Since 1.5 the children of `<component is>` are the component's snippets, as in its tag.
      snippets = componentSnippets(node, context);
    }
    const props: ComponentBinding["props"] = [];
    const models: ComponentBinding["models"] = [];
    let spread: ComponentBinding["spread"];
    const ref = templateRef(node, context, { kind: "component", reference, referenceOffset });
    for (const attribute of node.attrs ?? []) {
      if (attribute.name === "is" && !componentTag) continue;
      if (isRefDirective(attribute)) continue;
      const rawName = /^[^\s=]+/.exec(context.source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name;
      if (rawName === "bind") {
        spread = spreadAttribute(node, attribute, context);
        continue;
      }
      if (rawName === "model" || rawName.startsWith("model:")) {
        // `model` passes the model `default`; `model:open` the model `open` of the child's defineModel.
        const name = rawName === "model" ? "default" : rawName.slice(6);
        if (!/^[a-zA-Z_$][\w$]*$/.test(name)) throw compileError(context.source, context.filename, "MEEK066", `Nombre de modelo no válido: ${name}; escribe model="signal" o model:name="signal"`, attribute.start);
        const previous = models.find((model) => model.name === name);
        if (previous) throw compileError(context.source, context.filename, "MEEK066", `El modelo ${name} ya se pasa; deja un solo ${name === "default" ? "model" : rawName}`, attribute.start);
        if (!attribute.value.trim()) throw compileError(context.source, context.filename, "MEEK066", `${rawName} necesita una señal escribible: ${rawName}="signal"`, attribute.start);
        const offset = attributeValueOffset(node, attribute.name, context);
        validateExpression(attribute.value, context.source, context.filename, offset);
        models.push({ name, nameOffset: attribute.start, nameLength: rawName.length, expression: attribute.value, offset });
        continue;
      }
      let name: string;
      let nameOffset: number;
      let literal = false;
      if (rawName.startsWith("on:")) {
        // `on:save` sets the callback prop `onSave` declared by the child's defineEmits.
        const event = rawName.slice(3);
        if (!/^[a-zA-Z_$][\w$]*$/.test(event)) throw compileError(context.source, context.filename, "MEEK011", `Nombre de evento de componente no válido: ${event}`, attribute.start);
        name = emitPropName(event);
        nameOffset = attribute.start;
      } else if (rawName.startsWith("bind:") && (/^[a-zA-Z_$][\w$]*$/.test(rawName.slice(5)) || attributePropName(rawName.slice(5), attribute.start + 5, context))) {
        // Since 1.8 also `bind:aria-label` and `bind:data-state`: a prop with that name.
        name = rawName.slice(5);
        nameOffset = attribute.start + 5;
      } else if (awaitZone && rawName === "for") {
        // `for="items"` names the resource, like `each:of`: an expression, never text.
        name = rawName;
        nameOffset = attribute.start;
        if (!attribute.value.trim()) throw compileError(context.source, context.filename, "MEEK116", "<MeekoAwait> necesita for=\"recurso\": el resultado de useApi o useRpcQuery sin await, o una lista, como for=\"[items, stats]\"", attribute.start);
      } else if ((/^[a-zA-Z_$][\w$]*$/.test(rawName) && !reservedStaticProps.has(rawName)) || attributePropName(rawName, attribute.start, context)) {
        // `variant="primary"` passes its text as a string literal prop, as on an HTML element;
        // since 1.8 also `aria-label="Cerrar"` and `data-state="open"`.
        name = rawName;
        nameOffset = attribute.start;
        literal = true;
      } else {
        throw compileError(context.source, context.filename, "MEEK032", "Las props de un componente se pasan con prop=\"texto\", bind:prop=\"expresión\" u on:evento=\"manejador\"; is, ref, html y los nombres con guiones no son props, salvo aria-* y data-*", attribute.start);
      }
      const previous = props.find((prop) => prop.name === name);
      if (previous) {
        if (literal || previous.literal) {
          throw compileError(context.source, context.filename, "MEEK090", `${previous.attribute} y ${rawName} pasan los dos la prop ${name}; deja sólo el texto estático o sólo bind:${name}`, attribute.start);
        }
        throw compileError(context.source, context.filename, "MEEK048", `${previous.attribute} y ${rawName} asignan la misma prop ${name} del componente; deja sólo uno`, attribute.start);
      }
      if (literal) {
        const valueStart = attributeValueStart(context.source, attribute);
        if (valueStart === undefined) {
          // A bare `disabled` passes `true`, as a boolean prop expects; `disabled=""` passes "".
          props.push({ name, nameOffset, nameLength: name.length, attribute: rawName, expression: "true", offset: attribute.start, literal: true });
        } else {
          const quoted = /["']/.test(context.source[valueStart - 1] ?? "");
          props.push({ name, nameOffset, nameLength: name.length, attribute: rawName, expression: quote(attribute.value), offset: quoted ? valueStart - 1 : valueStart, literal: true });
        }
        continue;
      }
      const offset = attributeValueOffset(node, attribute.name, context);
      validateExpression(attribute.value, context.source, context.filename, offset);
      props.push({ name, nameOffset, nameLength: rawName.startsWith("on:") ? rawName.length : name.length, attribute: rawName, expression: attribute.value, offset });
    }
    for (const model of models) {
      const prop = props.find((candidate) => candidate.name === model.name);
      if (!prop) continue;
      const spelling = model.name === "default" ? "model" : `model:${model.name}`;
      const later = Math.max(model.nameOffset, prop.nameOffset - (prop.attribute.startsWith("bind:") ? 5 : 0));
      throw compileError(context.source, context.filename, "MEEK066", `${spelling} y ${prop.attribute} pasan los dos ${model.name}; un modelo no es una prop, deja sólo ${spelling}`, later);
    }
    if (awaitZone && !props.some((prop) => prop.name === "for")) {
      throw compileError(context.source, context.filename, "MEEK116", "<MeekoAwait> necesita for=\"recurso\": el resultado de useApi o useRpcQuery sin await, o una lista, como for=\"[items, stats]\"", position);
    }
    const id = context.nextRegion++;
    const referenceLength = outlet ? outletTag.length : shipped ? node.componentName!.length : reference.length;
    const tagLength = componentTag ? referenceLength + 1 : "<component".length;
    bindings.components.push({ id, reference, referenceOffset, ...(outlet || shipped ? { referenceLength } : {}), props, models, snippets, offset: position, tagLength, ...(ref ? { ref } : {}), ...(spread ? { spread } : {}), ...(context.branchComponents.has(node) ? { branch: true as const } : {}) });
    const entry = bindings.components.at(-1)!;
    const tagReference = narrowed(markSource(reference, referenceOffset, referenceLength), context.guards);
    const mappedProps = [
      ...(spread ? [spreadPropsCode(tagReference, markSource(spread.expression, spread.offset))] : []),
      ...props.map((prop) => `${markSource(quote(prop.name), prop.nameOffset, prop.nameLength)}: ${markSource(prop.expression, prop.offset)}`),
    ];
    const input = componentTagCall(entry, tagReference, markSource(`{ ${mappedProps.join(", ")} }`, position, node.end - position),
      models.map((model) => markSource(model.expression, model.offset)),
      snippets.map((snippet) => conditionalSnippet(`__meeko.snippet(${snippetParameters(snippet)} => ${snippet.render})`, snippet.condition && markSource(snippet.condition.expression, snippet.condition.offset))));
    // `any`: the tag call already checked the props; inferring them here would also infer the child's type parameters.
    return `__meeko.renderComponent<any>(${id}, ${markSource(reference, referenceOffset, referenceLength)}, ${input}, __meeko_transfer)`;
  }
  const tag = node.tagName!;

  const attrs: Array<{ kind: "static"; value: string } | { kind: "dynamic"; expression: string }> = [];
  // One `data-meeko="N"` per element: its attributes, events, model and ref all find it by that number.
  let element: number | undefined;
  const mark = (): number => element ??= context.nextElement++;
  // `ref:name` names the element for the script instead of becoming an HTML attribute.
  const ref = templateRef(node, context, { kind: "element", tag, svg: node.namespaceURI === "http://www.w3.org/2000/svg" });
  if (ref) {
    ref.element = mark();
    bindings.refs.push(ref);
  }
  // On a custom element (`<x-markdown html="intro">`), `html` and `model` stay HTML attributes, as in 1.0.
  const custom = isCustomElementTag(tag);
  const modelAttribute = custom ? undefined : node.attrs?.find((attribute) => attribute.name === "model" || attribute.name.startsWith("model:"));
  const model = modelAttribute ? nativeModel(node, modelAttribute, context, mark()) : undefined;
  if (model) {
    bindings.models.push(model);
    const value = `__meeko.modelValue(${markSource(model.expression, model.offset)})`;
    if (model.kind === "checkbox") attrs.push({ kind: "dynamic", expression: `__meeko.renderAttribute("checked", ${value})` });
    else if (model.kind === "radio") {
      const radio = model.radio && "code" in model.radio ? model.radio.code : markSource(model.radio!.expression, model.radio!.offset);
      attrs.push({ kind: "dynamic", expression: `__meeko.renderAttribute("checked", __meeko.modelSelected(${markSource(model.expression, model.offset)}, ${radio}))` });
    } else if (tag === "input") attrs.push({ kind: "dynamic", expression: `__meeko.renderAttribute("value", ${value})` });
  }
  // `html="expression"` fills the element with unescaped HTML; the marker carries its id.
  const htmlAttribute = custom ? undefined : node.attrs?.find((attribute) => attribute.name === "html");
  const html = htmlAttribute ? htmlDirective(node, htmlAttribute, model !== undefined, context) : undefined;
  if (html) {
    bindings.htmls.push(html);
    attrs.push({ kind: "static", value: ` data-meeko-h="${html.id}"` });
  }
  // An <option> of a <select model> renders `selected` from the model during SSR.
  let modelSelected = false;
  if (tag === "option" && context.selectModel && !node.attrs?.some((attribute) => attribute.name === "selected" || attribute.name === "bind:selected")) {
    const valueAttribute = node.attrs?.find((attribute) => attribute.name === "value" || attribute.name === "bind:value");
    if (valueAttribute) {
      const optionValue = valueAttribute.name === "value" ? quote(valueAttribute.value) : `(${valueAttribute.value})`;
      attrs.push({ kind: "dynamic", expression: `__meeko.renderAttribute("selected", __meeko.modelSelected(${context.selectModel.expression}, ${optionValue}))` });
      modelSelected = true;
    }
  }
  // `bind="obj"` writes the object's keys as attributes; on a custom element it stays an attribute, like `html`.
  const spreadDirective = custom ? undefined : node.attrs?.find((attribute) => attribute.name === "bind");
  const spread = spreadDirective ? spreadAttribute(node, spreadDirective, context) : undefined;
  /** The element's own attributes, which win over the spread's keys; `class` and `style` combine with it. */
  const excluded = new Set<string>(model ? ["value", "checked"] : []);
  if (modelSelected) excluded.add("selected");
  if (link) excluded.add("href").add("aria-current");
  const explicit: SpreadBinding["explicit"] = {};
  /** Where the spread's attributes go: at `bind` or at the explicit class or style before it. */
  let spreadIndex: number | undefined;
  // Since 1.8 `meeko check` and the editor check the value of an attribute with closed values in
  // the HTML data, such as `type` of `<button>`: a string literal outside them is MEEK122, a warning.
  const htmlTag = !custom && node.namespaceURI !== "http://www.w3.org/2000/svg";
  const checksValue = (name: string): boolean => context.narrow && htmlTag && closedAttributeValues(tag, name) !== undefined;
  const checkedValue = (code: string, name: string): string => checksValue(name) ? `__meeko.checkAttributeValue<${quote(tag)}, ${quote(name)}>()(${code})` : code;
  const joined = spread ? new Map<string, string>() : joinedAttributes(node);
  const bound = boundAttributeNames(node, (name) => foreignAttributeName(name, node.namespaceURI));
  for (const attr of node.attrs ?? []) {
    if (attr === spreadDirective) spreadIndex ??= attrs.length;
    if (isRefDirective(attr) || attr === modelAttribute || attr === htmlAttribute || attr === spreadDirective) continue;
    if (spread && (attr.name === "class" || attr.name === "style" || attr.name === "bind:class" || attr.name === "bind:style")) {
      // Combined with the spread's own class or style, in its single binding.
      spreadIndex ??= attrs.length;
      const name = attr.name.replace(/^bind:/, "") as "class" | "style";
      if (attr.name.startsWith("bind:")) {
        const offset = attributeValueOffset(node, attr.name, context);
        validateExpression(attr.value, context.source, context.filename, offset);
        addSpreadPart(explicit, name, { expression: attr.value, offset });
      } else addSpreadPart(explicit, name, { code: quote(attr.value) });
      continue;
    }
    if (attr.name.startsWith("on:")) {
      const name = attr.name.slice(3);
      if (!/^[a-z]+$/.test(name)) throw compileError(context.source, context.filename, "MEEK011", `Nombre de evento no válido: ${name}`, context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
      const id = mark();
      const offset = attributeValueOffset(node, attr.name, context);
      validateExpression(attr.value, context.source, context.filename, offset);
      bindings.events.push({ id, name, expression: attr.value, offset, tag, svg: node.namespaceURI === "http://www.w3.org/2000/svg" });
    } else if (attr.name.startsWith("bind:")) {
      const lowercase = attr.name.slice(5);
      if (!/^[a-z][a-z0-9:.-]*$/.test(lowercase) || lowercase.startsWith("on")) {
        throw compileError(context.source, context.filename, "MEEK012", `Atributo dinámico no válido: ${lowercase}`, context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
      }
      // parse5 lowercases every attribute name; in <svg> and <math>, `bind:viewBox` keeps its case, as `viewBox` does.
      const name = foreignAttributeName(lowercase, node.namespaceURI);
      // On a <MeekoLink>, its one binding below combines this value with the route.
      if (link && name === "aria-current") continue;
      const offset = attributeValueOffset(node, attr.name, context);
      validateExpression(attr.value, context.source, context.filename, offset);
      const id = mark();
      excluded.add(name);
      const fixed = joined.get(name);
      if (fixed !== undefined) {
        // The static class or style and this directive write one attribute, in SSR as in the browser.
        const value = attr.value;
        const build = (map: (expression: string, offset: number) => string): string => `__meeko.joinAttribute(${quote(name)}, ${quote(fixed)}, ${map(value, offset)})`;
        bindings.attributes.push({ id, name, expression: value, offset, build });
        attrs.push({ kind: "dynamic", expression: `__meeko.renderAttribute(${quote(name)}, ${build((expression, at) => markSource(expression, at))})` });
        continue;
      }
      bindings.attributes.push({ id, name, expression: attr.value, offset });
      attrs.push({ kind: "dynamic", expression: `__meeko.renderAttribute(${quote(name)}, ${checkedValue(markSource(attr.value, offset), name)})` });
    } else if (attr.name.startsWith(":")) {
      throw compileError(context.source, context.filename, "MEEK012", `Directiva de plantilla no admitida: ${attr.name}`, context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
    } else if (joined.has(attr.name)) {
      // Written by its `bind:` directive, joined with the dynamic value.
      excluded.add(attr.name);
    } else if (bound.has(attr.name)) {
      // Written by its `bind:` directive alone, in any order: with both, the browser keeps the first.
      excluded.add(attr.name);
      context.replacedAttributes.set(attr.start, attr.name);
    } else {
      excluded.add(attr.name);
      const valueStart = attributeValueStart(context.source, attr);
      const text = ` ${attr.name}="${escapeAttribute(attr.value)}"`;
      if (valueStart !== undefined && checksValue(attr.name)) {
        // Only in the code of the type check: the text stays, and its value is checked (MEEK122).
        const quoted = /["']/.test(context.source[valueStart - 1] ?? "");
        const literal = markSource(quote(attr.value), quoted ? valueStart - 1 : valueStart, attr.value.length + (quoted ? 2 : 0));
        attrs.push({ kind: "dynamic", expression: `(${checkedValue(literal, attr.name)}, ${quote(text)})` });
      } else attrs.push({ kind: "static", value: text });
    }
  }
  if (spread) {
    const binding: SpreadBinding = { id: mark(), ...spread, tag: quote(tag), excluded: [...excluded], explicit, filtered: false };
    bindings.spreads.push(binding);
    attrs.splice(spreadIndex ?? attrs.length, 0, { kind: "dynamic", expression: `__meeko.renderSpread(${spreadCode(binding, markSource)})` });
  }
  if (link) {
    // `href` from the typed `href()`, each part mapped to its attribute; `aria-current` on the committed route.
    const target = (map: (expression: string, offset: number) => string): string => {
      const options = (["params", "search"] as const).flatMap((key) => link[key] ? [`${key}: ${map(link[key].expression, link[key].offset)}`] : []);
      // Always an options object: a dynamic route without bind:params then reports the missing `params`.
      // The call maps to `to`, where TypeScript reports what the call itself lacks.
      return markSource(`__meeko_href(${map(link.to.expression, link.to.offset)}, { ${options.join(", ")} })`, link.to.offset, link.to.expression.length);
    };
    // A static route without params is its own href: a plain attribute, with no binding. The type
    // check still calls href(), so an unknown route is an error there.
    // Encoded per segment as href() does, so `/categorías` is `/categor%C3%ADas`, like the route's path.
    const fixed = !context.narrow && link.to.literal !== undefined && !link.to.literal.includes("[") && !link.params && !link.search
      ? staticRouteHref(link.to.literal)
      : undefined;
    // Since 1.8 the href goes through the application's link resolvers (`app.resolveLink`), with the
    // link's `to`, its hreflang (written, bound or a key of the spread) and `bind:resolve`. The type
    // check only needs `bind:resolve`: `to` and `hreflang` are checked where they already are.
    const resolved = (map: (expression: string, offset: number) => string): string => {
      const built = fixed === undefined ? target(map) : quote(fixed);
      const resolve = link.resolve ? `, ${map(link.resolve.expression, link.resolve.offset)}` : "";
      if (context.narrow) return `__meeko.linkHref(__meeko_links, "", ${built}${resolve ? `, undefined${resolve}` : ""})`;
      const hreflang = link.hreflang
        ? link.hreflang.literal === undefined ? `(${map(link.hreflang.expression, link.hreflang.offset)})` : link.hreflang.expression
        : spread ? `__meeko.linkHreflang(${map(spread.expression, spread.offset)})` : undefined;
      return `__meeko.linkHref(__meeko_links, ${link.to.literal === undefined ? `(${map(link.to.expression, link.to.offset)})` : link.to.expression}, ${built}${hreflang || resolve ? `, ${hreflang ?? "undefined"}` : ""}${resolve})`;
    };
    // A static route with a fixed hreflang resolves to the same href for the whole document: SSR
    // and every render write it, with no binding to keep.
    const constant = fixed !== undefined && !link.resolve && !spread && (link.hreflang === undefined || link.hreflang.literal !== undefined);
    if (constant) attrs.push({ kind: "dynamic", expression: `__meeko.renderAttribute("href", ${resolved((expression, offset) => markSource(expression, offset))})` });
    // `match="prefix"` passes its value; the default, `"exact"`, passes nothing.
    const match = link.match?.literal === "exact" ? undefined : link.match;
    // An aria-current of its own wins: `aria-current` or `bind:aria-current`, then the key of the
    // spread. The type check reads the spread where it is written, and the value of the attribute here.
    const own = (map: (expression: string, offset: number) => string): string | undefined => {
      if (link.current) return link.current.literal === undefined ? checkedValue(map(link.current.expression, link.current.offset), "aria-current") : link.current.expression;
      return spread && !context.narrow ? `__meeko.linkSpreadCurrent(${map(spread.expression, spread.offset)})` : undefined;
    };
    // aria-current compares the resolved href, so `/guide` is current at `/en/guide` in English.
    const current = (map: (expression: string, offset: number) => string): string => {
      const explicit = own(map);
      const mode = match ? (match.literal === undefined ? map(match.expression, match.offset) : match.expression) : undefined;
      return `__meeko.linkCurrent(__meeko_route, ${resolved(map)}${mode || explicit ? `, ${mode ?? "undefined"}` : ""}${explicit ? `, ${explicit}` : ""})`;
    };
    const marked = (expression: string, offset: number): string => markSource(expression, offset);
    // A written `aria-current="page"` is plain text, with no binding; the type check still reads `match`.
    const fixedCurrent = link.current?.literal !== undefined && !context.narrow;
    const written = [...(constant ? [] : [["href", resolved]] as const), ...(fixedCurrent ? [] : [["aria-current", current]] as const)];
    for (const [name, build] of written) {
      const id = mark();
      bindings.attributes.push({ id, name, expression: link.to.expression, offset: link.to.offset, build });
      attrs.push({ kind: "dynamic", expression: `__meeko.renderAttribute(${quote(name)}, ${build(marked)})` });
    }
  }
  if (element !== undefined) attrs.push({ kind: "static", value: ` data-meeko="${element}"` });
  // Every element carries the attribute, or with `scopeAttribute: "matched"` only those that a
  // scoped selector may match; SSR, hydration and every later render of a region share this string.
  if (context.scopeAttribute && context.scopeTargets(scopeCandidate(node, tag, custom, model !== undefined, modelSelected, [modelAttribute, htmlAttribute]))) {
    attrs.push({ kind: "static", value: ` ${context.scopeAttribute}=""` });
  }
  const openingParts: string[] = [quote(`<${tag}`)];
  for (const attr of attrs) {
    if (attr.kind === "dynamic") openingParts.push(attr.expression);
    else openingParts.push(quote(attr.value));
  }
  openingParts.push(quote(">"));
  const opening = openingParts.join(" + ");
  if (voidElements.has(tag)) return opening;
  if (html) {
    // The tag (and a foreign namespace) is the context that normalizes the HTML so it fits the element.
    const namespace = node.namespaceURI === "http://www.w3.org/2000/svg" ? ", \"svg\"" : node.namespaceURI === "http://www.w3.org/1998/Math/MathML" ? ", \"math\"" : "";
    return [opening, `__meeko.rawHtml(${htmlValue(html, context)}, ${quote(tag)}${namespace})`, quote(`</${tag}>`)].join(" + ");
  }
  if (model && tag === "textarea") return [opening, `__meeko.modelText(${markSource(model.expression, model.offset)})`, quote("</textarea>")].join(" + ");
  const selectModel = context.selectModel;
  if (model && tag === "select") context.selectModel = { expression: model.expression, offset: model.offset };
  let children: string[];
  try { children = (node.childNodes ?? []).map((child) => renderNode(child, bindings, context)); }
  finally { context.selectModel = selectModel; }
  return [opening, ...children, quote(`</${tag}>`)].join(" + ");
}

/** Every tag that `<component is>` may render, for an expression whose type decides. */
const allTagNames: readonly string[] = Object.keys(elementAttributeNames).filter(isTagName);

/** A name that is a prop of a component tag: an identifier. */
function isPropName(name: string): boolean {
  return /^[a-zA-Z_$][\w$]*$/.test(name);
}

/**
 * `<component is="expression">` whose expression may give an HTML tag. With `literals`, every result
 * of the expression is one of these tags: an element whose tag changes, with its children as they
 * are. Without them, the value's type decides at run time: a tag renders the element and a component
 * renders the component, between component markers; the children are the component's snippets and
 * the element's content is the `default` one.
 *
 * Attributes go to the element as on any element, except those that are not global: those are only
 * written while the current tag accepts them, according to the HTML data. With a component, the
 * same attributes are its props, events, models and `bind="obj"`.
 */
function renderDynamicTag(node: TemplateNode, bindings: TemplateBindings, context: TemplateContext, reference: string, referenceOffset: number, literals: ReadonlyArray<{ tag: string; offset: number }> | undefined, branch?: TagBinding["branch"]): string {
  const fail = (code: string, message: string, offset: number): never => { throw compileError(context.source, context.filename, code, message, offset); };
  const mixed = literals === undefined;
  // Inside <svg> or <math>, `is` only admits components: an HTML tag would not belong there.
  const foreign = node.namespaceURI !== undefined && node.namespaceURI !== "http://www.w3.org/1999/xhtml";
  const htmlAttribute = node.attrs?.find((attribute) => attribute.name === "html");
  const children = (node.childNodes ?? []).some(isContent);
  const content = children || htmlAttribute !== undefined;
  for (const literal of literals ?? []) {
    const at = referenceOffset + literal.offset;
    if (foreign) fail("MEEK112", `<component is> dentro de <svg> o <math> sólo admite componentes, no la etiqueta "${literal.tag}"`, at);
    if (!isTagName(literal.tag)) fail("MEEK112", `<component is> no puede renderizar <${literal.tag}>: is admite un componente o una etiqueta HTML que pueda tener contenido de plantilla, no script, style, iframe, object, embed, template, textarea ni etiquetas desconocidas`, at);
    if (content && isVoidTag(literal.tag)) fail("MEEK031", `<${literal.tag}> no admite contenido; quita el contenido de <component is> o elige otra etiqueta`, at);
  }
  const tags = literals ? [...new Set(literals.map((literal) => literal.tag))] : allTagNames;
  const element = context.nextElement++;
  const tagVariable = `__meeko_tag_${element}`;
  // Since 1.8, as on an element: the value of an attribute with closed values is checked against
  // those of the possible tags (MEEK122), only in the code of the type check.
  const checksTagValue = (name: string): boolean => context.narrow && !foreign && closedAttributeValuesOf(tags, name) !== undefined;
  const checkedTagValue = (code: string, name: string): string => checksTagValue(name) ? `__meeko.checkAttributeValue<typeof ${tagVariable}, ${quote(name)}>()(${code})` : code;
  /** The element's own bindings, which a new tag hydrates again. */
  const own = emptyBindings();
  /** SSR code of the attributes of the opening tag. */
  const parts: string[] = [];
  const checks: DynamicBinding["checks"] = [];
  const props: ComponentBinding["props"] = [];
  const models: ComponentBinding["models"] = [];
  const excluded = new Set<string>();
  const explicit: SpreadBinding["explicit"] = {};
  const spreadDirective = node.attrs?.find((attribute) => attribute.name === "bind");
  const spread = spreadDirective ? spreadAttribute(node, spreadDirective, context) : undefined;
  const ref = templateRef(node, context, mixed
    ? { kind: "dynamic", reference, referenceOffset }
    : { kind: "element", tag: tags[0]!, svg: false, tagType: tags.map(quote).join(" | ") });
  if (ref) {
    ref.element = element;
    own.refs.push(ref);
  }
  const typeCheck = (attribute: { start: number }, length: number): string => context.narrow ? `, ${markSource("true", attribute.start, length)}` : "";
  /** The check that the current tag accepts a non-global attribute, or `undefined` when every tag does. */
  const accepting = (name: string, attribute: { start: number }, length: number): string | undefined => {
    const accepted = tagsAccepting(name, tags);
    if (accepted === null || (literals && accepted.length === tags.length)) return undefined;
    return `__meeko.tagAttribute(${tagVariable}, ${quote(name)}, ${JSON.stringify(accepted)}${typeCheck(attribute, length)})`;
  };
  const only = (kind: "tag" | "component", feature: string, attribute: { start: number }, length: number): void => {
    if (mixed) checks.push({ feature, kind, offset: attribute.start, length });
  };
  let html: HtmlBinding | undefined;
  /** Where the spread's attributes go: at `bind` or at the explicit class or style before it. */
  let spreadIndex: number | undefined;
  /** A prop for the component, once; like on a component tag, twice is MEEK090 or MEEK048. */
  const addProp = (prop: ComponentBinding["props"][number], at: number): void => {
    const previous = props.find((other) => other.name === prop.name);
    if (previous) fail(previous.literal || prop.literal ? "MEEK090" : "MEEK048", `${previous.attribute} y ${prop.attribute} pasan los dos la prop ${prop.name}; deja sólo uno`, at);
    props.push(prop);
  };
  // With a tag only, the static class or style and its `bind:` directive write one attribute, as on an element.
  const joined = spread || mixed ? new Map<string, string>() : joinedAttributes(node);
  const bound = boundAttributeNames(node, (name) => name);
  for (const attribute of node.attrs ?? []) {
    if (attribute === spreadDirective || (spread && /^(?:bind:)?(?:class|style)$/.test(attribute.name))) spreadIndex ??= parts.length;
    if (attribute.name === "is" || isRefDirective(attribute) || attribute === spreadDirective) continue;
    const rawName = /^[^\s=]+/.exec(context.source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name;
    const name = attribute.name;
    if (attribute === htmlAttribute) {
      if (children) fail("MEEK095", "Un elemento con html no admite hijos: el HTML de la expresión es todo su contenido", attribute.start);
      if (!attribute.value.trim()) fail("MEEK095", "html necesita una expresión que devuelva HTML: html=\"content\"", attribute.start);
      const offset = attributeValueOffset(node, attribute.name, context);
      validateExpression(attribute.value, context.source, context.filename, offset);
      html = { id: context.nextHtml++, expression: attribute.value, offset };
      own.htmls.push(html);
      parts.push(quote(` data-meeko-h="${html.id}"`));
      only("tag", "html", attribute, 4);
      continue;
    }
    if (rawName === "model" || rawName.startsWith("model:")) {
      if (!mixed) fail("MEEK112", "model no se admite en <component is> con una etiqueta: los modelos son de los componentes; usa un control de formulario con model", attribute.start);
      const modelName = rawName === "model" ? "default" : rawName.slice(6);
      if (!isPropName(modelName)) fail("MEEK066", `Nombre de modelo no válido: ${modelName}; escribe model="signal" o model:name="signal"`, attribute.start);
      if (models.some((model) => model.name === modelName)) fail("MEEK066", `El modelo ${modelName} ya se pasa; deja un solo ${modelName === "default" ? "model" : rawName}`, attribute.start);
      if (!attribute.value.trim()) fail("MEEK066", `${rawName} necesita una señal escribible: ${rawName}="signal"`, attribute.start);
      const offset = attributeValueOffset(node, attribute.name, context);
      validateExpression(attribute.value, context.source, context.filename, offset);
      models.push({ name: modelName, nameOffset: attribute.start, nameLength: rawName.length, expression: attribute.value, offset });
      only("component", rawName, attribute, rawName.length);
      continue;
    }
    if (name.startsWith("on:")) {
      const event = rawName.slice(3);
      const domEvent = /^[a-z]+$/.test(event);
      const prop = mixed && isPropName(event);
      if (!domEvent && !prop) fail("MEEK011", `Nombre de evento no válido: ${event}`, attribute.start);
      const offset = attributeValueOffset(node, attribute.name, context);
      validateExpression(attribute.value, context.source, context.filename, offset);
      if (domEvent) own.events.push({ id: element, name: event, expression: attribute.value, offset, tag: "", svg: false, tagType: `typeof ${tagVariable}` });
      else only("component", rawName, attribute, rawName.length);
      if (prop) addProp({ name: emitPropName(event), nameOffset: attribute.start, nameLength: rawName.length, attribute: rawName, expression: attribute.value, offset }, attribute.start);
      continue;
    }
    if (name.startsWith("bind:")) {
      const attributeName = name.slice(5);
      const propName = rawName.slice(5);
      const domAttribute = /^[a-z][a-z0-9:.-]*$/.test(attributeName) && !attributeName.startsWith("on");
      const prop = mixed && (isPropName(propName) || isAttributeProp(propName));
      if (!domAttribute && !prop) fail("MEEK012", `Atributo dinámico no válido: ${attributeName}`, attribute.start);
      const offset = attributeValueOffset(node, attribute.name, context);
      validateExpression(attribute.value, context.source, context.filename, offset);
      if (!domAttribute) only("component", rawName, attribute, rawName.length);
      else if (spread && (attributeName === "class" || attributeName === "style")) addSpreadPart(explicit, attributeName, { expression: attribute.value, offset });
      else {
        excluded.add(attributeName);
        const accepts = accepting(attributeName, attribute, rawName.length);
        const value = attribute.value;
        const fixed = joined.get(attributeName);
        if (fixed !== undefined) {
          // `class` and `style` are global: every tag accepts them, so there is no `accepts` check.
          const build = (map: (expression: string, offset: number) => string): string => `__meeko.joinAttribute(${quote(attributeName)}, ${quote(fixed)}, ${map(value, offset)})`;
          own.attributes.push({ id: element, name: attributeName, expression: value, offset, build });
          parts.push(`__meeko.renderAttribute(${quote(attributeName)}, ${build((expression, at) => markSource(expression, at))})`);
        } else {
          own.attributes.push({ id: element, name: attributeName, expression: value, offset, ...(accepts ? { build: (map: (expression: string, offset: number) => string) => `${accepts} ? (${map(value, offset)}) : undefined` } : {}) });
          const checked = checkedTagValue(markSource(value, offset), attributeName);
          parts.push(`__meeko.renderAttribute(${quote(attributeName)}, ${accepts ? `${accepts} ? (${checked}) : undefined` : checked})`);
        }
      }
      if (prop) addProp({ name: propName, nameOffset: attribute.start + 5, nameLength: propName.length, attribute: rawName, expression: attribute.value, offset }, attribute.start);
      else only("tag", rawName, attribute, rawName.length);
      continue;
    }
    if (name.startsWith(":")) fail("MEEK012", `Directiva de plantilla no admitida: ${name}`, attribute.start);
    if (spread && (name === "class" || name === "style")) addSpreadPart(explicit, name, { code: quote(attribute.value) });
    else if (joined.has(name)) excluded.add(name);
    else if (bound.has(name)) {
      // Written by its `bind:` directive alone, as on an element. With a component it is MEEK090 below.
      excluded.add(name);
      context.replacedAttributes.set(attribute.start, name);
    } else {
      excluded.add(name);
      const accepts = accepting(name, attribute, rawName.length);
      let text = quote(` ${name}="${escapeAttribute(attribute.value)}"`);
      const valueStart = attributeValueStart(context.source, attribute);
      if (valueStart !== undefined && checksTagValue(name)) {
        const quoted = /["']/.test(context.source[valueStart - 1] ?? "");
        text = `(${checkedTagValue(markSource(quote(attribute.value), quoted ? valueStart - 1 : valueStart, attribute.value.length + (quoted ? 2 : 0)), name)}, ${text})`;
      }
      parts.push(accepts ? `(${accepts} ? ${text} : "")` : text);
    }
    if (!mixed) continue;
    if ((isPropName(rawName) && !reservedStaticProps.has(rawName)) || isAttributeProp(rawName)) {
      const valueStart = attributeValueStart(context.source, attribute);
      if (valueStart === undefined) addProp({ name: rawName, nameOffset: attribute.start, nameLength: rawName.length, attribute: rawName, expression: "true", offset: attribute.start, literal: true }, attribute.start);
      else {
        const quoted = /["']/.test(context.source[valueStart - 1] ?? "");
        addProp({ name: rawName, nameOffset: attribute.start, nameLength: rawName.length, attribute: rawName, expression: quote(attribute.value), offset: quoted ? valueStart - 1 : valueStart, literal: true }, attribute.start);
      }
    } else only("tag", rawName, attribute, rawName.length);
  }
  if (spread) {
    const binding: SpreadBinding = { id: element, ...spread, tag: tagVariable, excluded: [...excluded], explicit, filtered: true };
    own.spreads.push(binding);
    parts.splice(spreadIndex ?? parts.length, 0, `__meeko.renderSpread(${spreadCode(binding, markSource)})`);
  }
  parts.push(quote(` data-meeko="${element}"`));
  if (context.scopeAttribute && (mixed || tags.some((tag) => context.scopeTargets(scopeCandidate(node, tag, false, false, false, [htmlAttribute]))))) {
    parts.push(quote(` ${context.scopeAttribute}=""`));
  }
  const open = [quote("<"), tagVariable, ...parts, quote(">")].join(" + ");
  const close = `__meeko.closeTag(${tagVariable})`;
  // The tags of a branch need no guard: their type does not depend on it (see `branchValue`).
  const value = branch && context.narrow ? branchValue(reference, branch, true) : narrowed(branchValue(markSource(reference, referenceOffset), branch, context.narrow), context.guards);
  const htmlContent = html ? [`__meeko.rawHtml(${htmlValue(html, context)}, ${tagVariable})`] : [];
  if (!mixed) {
    const inner = htmlContent.length ? htmlContent : (node.childNodes ?? []).map((child) => renderNode(child, bindings, context));
    bindings.tags.push({ element, reference, referenceOffset, tagVariable, content, open, bindings: own, offset: node.start, ...(branch ? { branch } : {}) });
    return `__meeko.renderElementTag(${value}, (${tagVariable}) => ${[open, ...inner, close].join(" + ")}, ${content})`;
  }
  // The children are the component's snippets; the element renders the `default` one.
  const snippets = componentSnippets(node, context);
  for (const snippet of snippets) if (snippet.name !== "default") checks.push({ feature: "<snippet>", kind: "component", offset: snippet.nameOffset, length: snippet.nameLength });
  const fallback = snippets.find((snippet) => snippet.name === "default");
  const contentRegion = fallback ? context.nextRegion++ : undefined;
  const id = context.nextRegion++;
  const component: ComponentBinding = { id, reference, referenceOffset, props, models, snippets, offset: node.start, tagLength: "<component".length, ...(ref ? { ref } : {}), ...(spread ? { spread } : {}) };
  bindings.dynamics.push({ id, element, reference, referenceOffset, tagVariable, content, open, bindings: own, offset: node.start, svg: foreign, component, ...(contentRegion !== undefined ? { contentRegion } : {}), checks });
  const componentVariable = `__meeko_component_${id}`;
  const mappedProps = [
    ...(spread ? [spreadPropsCode(componentVariable, markSource(spread.expression, spread.offset))] : []),
    ...props.map((prop) => `${markSource(quote(prop.name), prop.nameOffset, prop.nameLength)}: ${markSource(prop.expression, prop.offset)}`),
  ];
  const input = componentTagCall(component, componentVariable, markSource(`{ ${mappedProps.join(", ")} }`, node.start, node.end - node.start),
    models.map((model) => markSource(model.expression, model.offset)),
    snippets.map((snippet) => conditionalSnippet(`__meeko.snippet(${snippetParameters(snippet)} => ${snippet.render})`, snippet.condition && markSource(snippet.condition.expression, snippet.condition.offset))));
  const elementContent = htmlContent.length ? htmlContent : fallback ? [`__meeko.renderSnippet(${contentRegion}, __meeko.snippet(() => ${fallback.render}), [])`] : [];
  return `__meeko.renderDynamic(${id}, ${value}, (${tagVariable}) => ${[open, ...elementContent, close].join(" + ")}, (${componentVariable}) => __meeko.renderComponent<any>(${id}, ${componentVariable}, ${input}, __meeko_transfer), ${content}, ${foreign})`;
}

/**
 * The name of a `bind:` attribute as the HTML parser writes the static one: in SVG and MathML,
 * with the case of the standard (`viewBox`, `preserveAspectRatio`, `definitionURL`), from the
 * tables of parse5. Elsewhere, and for any other name, the lowercase name.
 */
function foreignAttributeName(name: string, namespace: string | undefined): string {
  const svg = namespace === "http://www.w3.org/2000/svg";
  if (!svg && namespace !== "http://www.w3.org/1998/Math/MathML") return name;
  const token = { attrs: [{ name, value: "" }] } as unknown as Parameters<typeof foreignContent.adjustTokenSVGAttrs>[0];
  if (svg) foreignContent.adjustTokenSVGAttrs(token);
  else foreignContent.adjustTokenMathMLAttrs(token);
  return token.attrs[0]!.name;
}

/**
 * The value of `is` in its branch of HTML tags, without the component names of the other branches.
 * `meeko check` reads the type of its tags instead: behind the condition of the branch, the
 * conditions of `is` itself would be narrowed against themselves (TS2367), and every other part of
 * the expression is checked by the conditions of the regions and the literals by the compiler.
 */
function branchValue(code: string, branch: TagBinding["branch"], narrow: boolean): string {
  if (!branch) return code;
  return narrow ? `(null! as ${branch.tags.map(quote).join(" | ")})` : `__meeko.tagBranch(${code}, ${JSON.stringify(branch.names)}, ${quote(branch.fallback)})`;
}

/** Meeko's own tags that `is` cannot name: they render no element or component of their own. */
const unnamedBuiltins = new Set([outletTag, teleportTag]);

/** A branch of `<component is>` with names: `<MeekoLink>`, a component, or the HTML tags of `is`. */
type IsBranch = { kind: "link" | "component"; name: string; leaves: IsLeaf[] } | { kind: "tags"; leaves: IsLeaf[] };

/**
 * `<component is>` whose expression gives component names as string literals (since 1.8), such as
 * `to ? 'MeekoLink' : href ? 'a' : 'button'`. Each name is resolved at compile time, as its tag
 * would be: one `if:when` region per name, whose condition is the path of `?:` to its literals,
 * plus one region for the HTML tags, an element whose tag changes. SSR, hydration and updates are
 * those of `if:when`, and `meeko check` checks each branch behind its condition, which narrows it.
 *
 * Each attribute goes to the branches that take it: `to`, `params`, `search` and `match` to
 * `<MeekoLink>`, with the other attributes of its `<a>` except `href`; the attributes of the HTML
 * data to the tags that accept them; and every prop to the components, whose check tolerates the
 * props of other branches. An attribute that no branch takes is MEEK112 in `meeko check`.
 */
function renderNamedIs(node: TemplateNode, bindings: TemplateBindings, context: TemplateContext, reference: string, referenceOffset: number, leaves: readonly IsLeaf[]): string {
  const fail = (code: string, message: string, offset: number): never => { throw compileError(context.source, context.filename, code, message, offset); };
  const names = new Map<string, IsLeaf[]>();
  const rest: IsLeaf[] = [];
  for (const leaf of leaves) {
    const at = referenceOffset + leaf.offset;
    const name = leaf.literal;
    if (name === undefined) {
      fail("MEEK132", `con nombres de componente entre comillas, cada resultado de is es un literal: una etiqueta HTML en minúscula, como 'a', o un componente en PascalCase, como 'MeekoLink'; ${reference.slice(leaf.offset, leaf.offset + leaf.length).trim()} no lo es`, at);
      continue;
    }
    if (!isComponentName(name)) {
      rest.push(leaf);
      continue;
    }
    const shadowed = context.shadowedTags.has(name);
    if (!shadowed && unnamedBuiltins.has(name)) fail("MEEK132", `is no admite '${name}': <${name}> no renderiza un elemento ni un componente propio; los nombres de is son 'MeekoLink' y los componentes importados o autoimportados`, at);
    const known = (name === linkTag && !shadowed) || (!shadowed && builtinComponentModules[name] !== undefined) || context.componentNames.names.has(name);
    if (!known && context.componentNames.complete) {
      fail("MEEK132", `'${name}' no es una etiqueta HTML ni un componente conocido: las etiquetas van en minúscula, como 'button', y los componentes en PascalCase, importados o autoimportados, como 'MeekoLink' o 'UICard'`, at);
    }
    names.set(name, [...names.get(name) ?? [], leaf]);
  }
  const branches: IsBranch[] = [...names].map(([name, list]) => ({ kind: name === linkTag && !context.shadowedTags.has(name) ? "link" : "component", name, leaves: list }));
  if (rest.length) branches.push({ kind: "tags", leaves: rest });
  const tags = [...new Set(rest.map((leaf) => leaf.literal!))];
  const attrs = (node.attrs ?? []).filter((attribute) => attribute.name !== "is");
  const ref = attrs.find(isRefDirective);
  if (ref && branches.length > 1) {
    fail("MEEK052", "ref: no se admite en <component is> con varios nombres entre comillas: cada rama es un elemento o componente distinto; pon la ref en cada rama con if:when", ref.start);
  }
  const rawNameOf = (attribute: TemplateAttribute): string => /^[^\s=]+/.exec(context.source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name;
  const forElement = (attribute: TemplateAttribute, link: boolean): boolean => branchTakes(attribute, rawNameOf(attribute), link ? { kind: "link" } : { kind: "tags", tags });
  const forComponent = (attribute: TemplateAttribute): boolean => branchTakes(attribute, rawNameOf(attribute), { kind: "component" });
  const elementBranches = branches.filter((branch) => branch.kind !== "component");
  const componentBranches = branches.filter((branch): branch is Extract<IsBranch, { name: string }> => branch.kind === "component");
  const elementTakes = (attribute: TemplateAttribute): boolean => elementBranches.some((branch) => forElement(attribute, branch.kind === "link"));
  /** `meeko check`: an attribute that no branch takes, by its prop name, against the components' props. */
  const checks: string[] = [];
  const componentsCode = componentBranches.length
    ? `[${componentBranches.map((branch) => (!context.shadowedTags.has(branch.name) && builtinComponentModules[branch.name]?.alias) || branch.name).join(", ")}][0]!`
    : "undefined!";
  for (const attribute of attrs) {
    const raw = rawNameOf(attribute);
    if (isRefDirective(attribute) || attribute.name === "bind" || elementTakes(attribute)) continue;
    if (raw === "model" || raw.startsWith("model:")) {
      if (!componentBranches.length) fail("MEEK112", "model no se admite en <component is> sin componentes: los modelos son de los componentes; usa un control de formulario con model", attribute.start);
      continue;
    }
    if (attribute.name === "html") fail("MEEK112", "html sólo vale si is es una etiqueta HTML, y este is sólo da componentes", attribute.start);
    if (raw.startsWith("on:") && !componentBranches.length) fail("MEEK011", `Nombre de evento no válido: ${raw.slice(3)}`, attribute.start);
    if (!context.narrow) continue;
    const prop = raw.startsWith("on:") ? emitPropName(raw.slice(3)) : raw.startsWith("bind:") ? raw.slice(5) : raw;
    checks.push(`(__meeko.checkBranchAttribute(${quote(prop)}, () => ${componentsCode}, ${markSource("true", attribute.start, raw.length)}), "")`);
  }
  // Named `<snippet>` blocks are a component's; an element renders the loose content.
  const elementChildren = (node.childNodes ?? []).filter((child) => child.tagName !== "snippet");
  const branchNode = (branch: IsBranch): TemplateNode => {
    if (branch.kind === "tags") return { ...node, attrs: attrs.filter((attribute) => forElement(attribute, false)), childNodes: elementChildren };
    // The tag starts at the opening quote of the name: its errors and the tag check map to the literal.
    const own: TemplateNode = { ...node, nodeName: branch.name, tagName: branch.name, componentName: branch.name, start: referenceOffset + branch.leaves[0]!.offset };
    if (branch.kind === "link") return { ...own, attrs: attrs.filter((attribute) => forElement(attribute, true)), childNodes: elementChildren };
    const component: TemplateNode = { ...own, attrs: attrs.filter(forComponent) };
    context.branchComponents.add(component);
    return component;
  };
  const renderBranch = (branch: IsBranch, target: TemplateBindings): string => branch.kind === "tags"
    ? renderDynamicTag(branchNode(branch), target, context, reference, referenceOffset, branch.leaves.map((leaf) => ({ tag: leaf.literal!, offset: leaf.offset })), { tags, names: [...names.keys()], fallback: tags[0]! })
    : renderNodeContent(branchNode(branch), target, context);
  if (branches.length === 1) return [...checks, renderBranch(branches[0]!, bindings)].join(" + ");
  /** `!!(c1) && !(c2)`: the conditions of `?:` that lead to one of the literals of the branch. */
  const conditionOf = (list: readonly IsLeaf[]) => (map: (expression: string, offset: number) => string): string =>
    isBranchCondition(list, (text, offset) => map(text, referenceOffset + offset));
  const regions = branches.map((branch) => {
    const build = conditionOf(branch.leaves);
    const inner = emptyBindings();
    const outerGuards = context.guards;
    const guards = context.narrow ? [...outerGuards, { code: build(markSource), names: namesOf(reference) }] : outerGuards;
    context.guards = guards;
    let html: string;
    try { html = narrowed(renderBranch(branch, inner), guards); }
    finally { context.guards = outerGuards; }
    const id = context.nextRegion++;
    bindings.regions.push({ kind: "condition", id, expression: reference, offset: referenceOffset, build, render: html, bindings: inner });
    return `__meeko.renderIf(${id}, ${markSource(`(${build(markSource)})`, referenceOffset, reference.length)}, () => ${html})`;
  });
  return [...checks, ...regions].join(" + ");
}

/** `bind="obj"` on a tag: the expression of the object, which must be there. */
function spreadAttribute(node: TemplateNode, attribute: { name: string; value: string; start: number; end: number }, context: TemplateContext): { expression: string; offset: number } {
  if (attributeValueStart(context.source, attribute) === undefined || !attribute.value.trim()) {
    throw compileError(context.source, context.filename, "MEEK113", "bind necesita un objeto: bind=\"obj\" escribe sus claves como atributos (o como props en un componente)", attribute.start);
  }
  const offset = attributeValueOffset(node, attribute.name, context);
  validateExpression(attribute.value, context.source, context.filename, offset);
  return { expression: attribute.value, offset };
}

/** The props of `bind="obj"` in the props object of a component tag, before the explicit ones. */
function spreadPropsCode(reference: string, value: string): string {
  return `...__meeko.spreadProps(() => ${reference}, ${value})`;
}

/**
 * Adds the static `class` or `style`, or its `bind:` directive, to what `bind="obj"` combines. Written
 * together, in either order, they are one value, as they are on an element without a spread.
 */
function addSpreadPart(explicit: SpreadBinding["explicit"], name: "class" | "style", part: SpreadPart): void {
  const previous = explicit[name];
  if (!previous) explicit[name] = part;
  else if ("code" in part && "expression" in previous) explicit[name] = { ...previous, fixed: part.code };
  else if ("expression" in part && "code" in previous) explicit[name] = { ...part, fixed: previous.code };
}

/** SSR code of `bind="obj"` on an element, or the read of its hydration with `map` for its expressions. */
function spreadCode(spread: SpreadBinding, map: (expression: string, offset: number) => string): string {
  const part = (name: "class" | "style", value: SpreadPart): string => {
    if ("code" in value) return value.code;
    const dynamic = map(value.expression, value.offset);
    return value.fixed === undefined ? dynamic : `__meeko.joinAttribute(${quote(name)}, ${value.fixed}, ${dynamic})`;
  };
  const explicit = [
    ...(spread.explicit.class ? [`class: ${part("class", spread.explicit.class)}`] : []),
    ...(spread.explicit.style ? [`style: ${part("style", spread.explicit.style)}`] : []),
  ];
  const extra = spread.filtered ? `, ${explicit.length ? `{ ${explicit.join(", ")} }` : "undefined"}, __meeko.tagAccepts` : explicit.length ? `, { ${explicit.join(", ")} }` : "";
  return `__meeko.spreadEntries(${spread.tag}, ${map(spread.expression, spread.offset)}, ${JSON.stringify(spread.excluded)}${extra})`;
}

/**
 * `meeko check` only: the value of `is` gives tags that `<component is>` can render (MEEK112), and
 * no void tag when the element has content (MEEK031). `true` maps to the expression.
 */
function tagCheck(entry: TagBinding, value: string, svg: boolean): string {
  return `void (() => __meeko.checkTag(${value}, ${entry.content}, ${svg}, ${markSource("true", entry.referenceOffset, entry.reference.length)}));`;
}

/** The href of a route without parameters, with each segment encoded as `href()` encodes it. */
function staticRouteHref(id: string): string {
  const parts = id.split("/").filter(Boolean).map((part) => encodeURIComponent(part));
  return new URL(parts.length ? `/${parts.join("/")}` : "/", "http://meeko.local").pathname;
}

/**
 * `model="signal"` on a native control: text-like `<input>` and `<textarea>` (value, input),
 * checkbox and radio (checked, change), `<select>` (value, change) and `<select multiple>`.
 */
function nativeModel(node: TemplateNode, attribute: { name: string; value: string; start: number; end: number }, context: TemplateContext, id: number): ModelBinding {
  const fail = (message: string, offset = attribute.start): never => { throw compileError(context.source, context.filename, "MEEK065", message, offset); };
  const tag = node.tagName!;
  if (attribute.name !== "model") fail(`${/^[^\s=]+/.exec(context.source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name} nombra un modelo de componente; un control de formulario usa model="signal"`);
  const find = (name: string) => node.attrs?.find((candidate) => candidate.name === name);
  const second = node.attrs?.find((candidate) => candidate !== attribute && (candidate.name === "model" || candidate.name.startsWith("model:")));
  if (second) fail("Un control de formulario admite un solo model=\"signal\"; model:name es para etiquetas de componente", second.start);
  let kind: ModelBinding["kind"];
  if (tag === "input") {
    // With `bind:type` the control is text-like (a password field that shows its text): `value`
    // on `input`. The runtime reports a type that is not, such as checkbox, radio or file.
    const dynamicType = find("bind:type");
    const staticType = find("type");
    if (dynamicType && staticType) fail("model con bind:type no admite además type=\"...\"; deja sólo uno de los dos", staticType.start);
    const type = dynamicType ? "text" : (staticType?.value ?? "text").trim().toLowerCase();
    if (["file", "submit", "reset", "button", "image"].includes(type)) fail(`model no se admite en <input type="${type}">`);
    kind = type === "checkbox" ? "checkbox" : type === "radio" ? "radio" : "text";
  } else if (tag === "textarea") {
    kind = "text";
    if ((node.childNodes ?? []).some((child) => child.nodeName !== "#text" || Boolean(child.value?.trim()))) fail("<textarea model> no admite contenido; el modelo da su valor", node.start);
  } else if (tag === "select") {
    const dynamicMultiple = find("bind:multiple");
    if (dynamicMultiple) fail("model necesita un multiple estático en <select>; sustituye bind:multiple por multiple", dynamicMultiple.start);
    kind = find("multiple") ? "multiple" : "select";
  } else {
    return fail(`model se admite en <input>, <textarea> y <select>, no en <${tag}>`);
  }
  const property = kind === "checkbox" || kind === "radio" ? "checked" : "value";
  const event = kind === "text" ? "input" : "change";
  for (const conflict of [`bind:${property}`, property, `on:${event}`]) {
    const found = find(conflict);
    if (found) fail(`model asigna ${property} y escucha ${event}; quita ${conflict}`, found.start);
  }
  if (!attribute.value.trim()) fail("model necesita una señal escribible: model=\"signal\"");
  const offset = attributeValueOffset(node, attribute.name, context);
  validateExpression(attribute.value, context.source, context.filename, offset);
  let radio: ModelBinding["radio"];
  if (kind === "radio") {
    const value = find("value");
    const bound = find("bind:value");
    if (value) radio = { code: quote(value.value) };
    else if (bound) radio = { expression: bound.value, offset: attributeValueOffset(node, "bind:value", context) };
    else fail("Un radio con model necesita value=\"...\" o bind:value=\"expression\"");
  }
  return { id, kind, expression: attribute.value, offset, ...(radio ? { radio } : {}) };
}

/**
 * `html="expression"` on an element: the expression, a `string` (or `null`/`undefined` for an empty
 * element), is the element's whole content as **unescaped** HTML. SSR writes it as is; hydration
 * leaves matching HTML untouched and replaces `innerHTML` when it differs or the value changes.
 *
 * It is unsafe with untrusted content: HTML from users or third parties can run scripts (XSS), so
 * sanitize it first or use `{expression}`, which escapes. The element takes no children and is not
 * a void, raw-text or `<template>` element, and `html` does not combine with `model` (`MEEK095`).
 */
function htmlDirective(node: TemplateNode, attribute: { name: string; value: string; start: number; end: number }, hasModel: boolean, context: TemplateContext): HtmlBinding {
  const fail = (message: string, offset = attribute.start): never => { throw compileError(context.source, context.filename, "MEEK095", message, offset); };
  const tag = node.tagName!;
  if (voidElements.has(tag)) fail(`html no se admite en <${tag}>, que no tiene contenido`);
  if (rawTextElements.has(tag)) fail(`html no se admite en <${tag}>, cuyo contenido no es HTML`);
  if (hasModel) fail("html no se combina con model: el modelo ya da el valor del control");
  const child = (node.childNodes ?? []).find((candidate) => candidate.nodeName !== "#text" || Boolean(candidate.value?.trim()));
  if (child) fail(`Un elemento con html no admite hijos: el HTML de la expresión es todo su contenido; deja <${tag} html="..."></${tag}> vacío`, child.start);
  if (!attribute.value.trim()) fail("html necesita una expresión que devuelva HTML: html=\"content\"");
  const offset = attributeValueOffset(node, attribute.name, context);
  validateExpression(attribute.value, context.source, context.filename, offset);
  return { id: context.nextHtml++, expression: attribute.value, offset };
}

/**
 * The SSR value of `html="expression"`. For `meeko check` (`narrow`), the expression goes through
 * `__meeko.checkTrustedHtml`, whose second argument fails with the `MEEK107` type text when the
 * value is an untrusted `string` (see `TrustedHtmlCheck`); that argument maps to the expression,
 * and the whole call too, so that `rawHtml` still reports a non-string value at the expression.
 * The modules that run never include the check.
 */
function htmlValue(html: HtmlBinding, context: TemplateContext): string {
  const value = markSource(html.expression, html.offset);
  if (!context.narrow) return value;
  const length = html.expression.length;
  return markSource(`__meeko.checkTrustedHtml(${value}, ${markSource("true", html.offset, length)})`, html.offset, length);
}

/**
 * Comprobación y props de una etiqueta de componente: `__meeko.componentTag(() => Hijo)(props,
 * eventos, modelos, snippets)`. El `__meekoTag` del hijo tipa la llamada: si es genérico, sus
 * parámetros de tipo se infieren una sola vez a partir de las props y tipan los manejadores
 * `on:evento`, los modelos y los snippets. Las props se comprueban exactas, como en
 * `componentProps`: los literales conservan su tipo y una prop desconocida es una propiedad
 * sobrante, también junto a props conocidas. Sólo los nombres que empiezan por `on` se comprueban
 * en el objeto de nombres de evento, para que un `on:evento` desconocido dé un único error y su
 * manejador no reciba además parámetros `any` implícitos. Los nombres de evento, los modelos y los
 * snippets son objetos mapeados a la etiqueta, donde se informa de uno obligatorio que falta, con
 * cada nombre mapeado a su atributo.
 */
function componentTagCall(entry: ComponentBinding, reference: string, props: string, models: readonly string[], snippets: readonly string[]): string {
  const channel = (entries: readonly string[]): string => markSource(entries.length ? `{ ${entries.join(", ")} }` : "__meeko.noChannels", entry.offset, entry.tagLength);
  const events = entry.props.filter((prop) => prop.name.startsWith("on")).map((prop) => `${markSource(quote(prop.name), prop.nameOffset, prop.nameLength)}: true`);
  const modelEntries = entry.models.map((model, index) => `${markSource(quote(model.name), model.nameOffset, model.nameLength)}: ${models[index]}`);
  const snippetEntries = entry.snippets.map((snippet, index) => `${markSource(quote(snippet.name), snippet.nameOffset, snippet.nameLength)}: ${snippets[index]}`);
  return `__meeko.${entry.branch ? "branchTag" : "componentTag"}(() => ${reference})(${props}, ${channel(events)}, ${channel(modelEntries)}, ${channel(snippetEntries)})`;
}

/** Parameter list of a snippet's render function, mapped to its `params` attribute. */
function snippetParameters(entry: SnippetBinding): string {
  const list = `(${entry.params.join(", ")})`;
  return entry.params.length ? markSource(list, entry.paramsOffset, entry.paramsLength) : list;
}

/**
 * The value of a snippet in the tag's snippets: with `if:when`, `undefined` while the condition is
 * false, so the child sees no snippet. `undefined!` keeps the type of the snippet, so the tag
 * checks it as passed; a required snippet is MEEK110 (see {@link snippetConditionCheck}).
 */
function conditionalSnippet(value: string, condition: string | undefined): string {
  return condition === undefined ? value : `(!!(${condition}) ? ${value} : undefined!)`;
}

/**
 * `meeko check` only: `if:when` on a `<snippet>` needs an optional snippet of the child. The
 * argument `true` maps to `if:when`, where a required snippet fails with the MEEK110 type text.
 */
function snippetConditionCheck(entry: SnippetBinding, reference: string): string {
  const condition = entry.condition!;
  return `void (() => __meeko.checkSnippetCondition(() => ${reference}, ${quote(entry.name)}, ${markSource("true", condition.attributeOffset, "if:when".length)}));`;
}

function isContent(node: TemplateNode): boolean {
  return node.nodeName !== "#comment" && (node.nodeName !== "#text" || Boolean(node.value?.trim()));
}

/** Compiles snippet content in the parent's template, with its own bindings. */
function compileSnippet(nodes: readonly TemplateNode[], context: TemplateContext, entry: Omit<SnippetBinding, "id" | "render" | "bindings">): SnippetBinding {
  const bindings = emptyBindings();
  const selectModel = context.selectModel;
  const outerGuards = context.guards;
  // The snippet is a function of its own: its content is checked behind the conditions around the
  // tag and its own `if:when`, which the parent evaluates outside the snippet's parameters.
  const condition = entry.condition && context.narrow
    ? [{ code: markSource(entry.condition.expression, entry.condition.offset), names: namesOf(entry.condition.expression) }]
    : [];
  const narrowing = context.narrow
    ? (entry.narrowing ?? []).map((item) => ({ code: markSource(item.expression, item.offset, item.length), names: namesOf(item.expression) }))
    : [];
  const guards = unshadowed([...outerGuards, ...condition, ...narrowing], entry.params);
  context.selectModel = undefined;
  context.guards = guards;
  context.snippetDepth++;
  let render: string;
  try { render = narrowed(nodes.map((child) => renderNode(child, bindings, context)).join(" + ") || quote(""), guards); }
  finally {
    context.snippetDepth--;
    context.selectModel = selectModel;
    context.guards = outerGuards;
  }
  return { id: context.nextSnippet++, ...entry, render, bindings };
}

/**
 * Valid `name` of a `<snippet>`: an identifier, optionally followed by hyphen-joined segments of
 * identifier characters (`title`, `cell-email`, `header-created-at`, `cell-2024`). The name is a
 * property key of the child's snippets, so dynamic names from a mapped type over a generic, such
 * as `` `cell-${K}` ``, can be filled; a trailing or doubled hyphen is rejected.
 */
const snippetNamePattern = /^[A-Za-z_$][\w$]*(?:-[\w$]+)*$/;

/**
 * Children of a component tag: each `<snippet name params>` fills a named snippet and the rest of
 * the content, if it is not only whitespace and comments, fills `default`.
 */
function componentSnippets(node: TemplateNode, context: TemplateContext, defaultNarrowing: NonNullable<SnippetBinding["narrowing"]> = []): SnippetBinding[] {
  const fail = (message: string, offset: number): never => { throw compileError(context.source, context.filename, "MEEK061", message, offset); };
  const named: Array<{ node: TemplateNode; entry: Omit<SnippetBinding, "id" | "render" | "bindings"> }> = [];
  const loose: TemplateNode[] = [];
  for (const child of node.childNodes ?? []) {
    if (child.tagName !== "snippet") {
      loose.push(child);
      continue;
    }
    for (const attribute of child.attrs ?? []) {
      if (attribute.name !== "name" && attribute.name !== "params" && attribute.name !== "if:when") fail(`<snippet> admite name, params e if:when; ${attribute.name} no se admite`, attribute.start);
    }
    const nameAttribute = child.attrs?.find((attribute) => attribute.name === "name");
    const name = nameAttribute?.value.trim() ?? "";
    if (!nameAttribute || !snippetNamePattern.test(name)) fail("<snippet> necesita name con el nombre del snippet del hijo que llena: un identificador o segmentos unidos por guiones, como name=\"title\" o name=\"cell-email\"", nameAttribute?.start ?? child.start);
    const nameOffset = attributeValueOffset(child, "name", context);
    if (named.some((other) => other.entry.name === name)) fail(`El snippet ${name} ya está lleno`, nameOffset);
    const paramsAttribute = child.attrs?.find((attribute) => attribute.name === "params");
    const params: string[] = [];
    let paramsOffset = child.start;
    if (paramsAttribute) {
      paramsOffset = attributeValueOffset(child, "params", context);
      let cursor = 0;
      for (const part of paramsAttribute.value.split(",")) {
        const param = part.trim();
        const at = paramsOffset + cursor + part.indexOf(param);
        cursor += part.length + 1;
        if (!param && paramsAttribute.value.trim() === "") break;
        if (!/^[A-Za-z_$][\w$]*$/.test(param) || param.startsWith("__")) fail(`Parámetro de snippet no válido: "${param}"; params es una lista de identificadores, como params="item, index"`, at);
        if (params.includes(param)) fail(`El parámetro de snippet ${param} está repetido`, at);
        params.push(param);
      }
    }
    // `if:when` passes the snippet only while its condition is true, evaluated in the parent's scope.
    const conditionAttribute = child.attrs?.find((attribute) => attribute.name === "if:when");
    let condition: SnippetBinding["condition"];
    if (conditionAttribute) {
      if (!conditionAttribute.value.trim()) fail(`if:when de <snippet> necesita una condición: el snippet ${name} se pasa sólo mientras es verdadera, como if:when="snippets.${name}"`, conditionAttribute.start);
      const offset = attributeValueOffset(child, "if:when", context);
      validateExpression(conditionAttribute.value, context.source, context.filename, offset);
      condition = { expression: conditionAttribute.value, offset, attributeOffset: conditionAttribute.start };
    }
    named.push({ node: child, entry: { name, nameOffset, nameLength: nameAttribute!.value.length, params, paramsOffset, paramsLength: paramsAttribute?.value.length ?? 0, ...(condition ? { condition } : {}) } });
  }
  const result: SnippetBinding[] = [];
  const first = loose.find(isContent);
  if (first) {
    const explicit = named.find((item) => item.entry.name === "default");
    if (explicit) fail("El contenido fuera de <snippet> ya llena default; muévelo dentro de <snippet name=\"default\"> o quita ese snippet", explicit.entry.nameOffset);
    result.push(compileSnippet(loose, context, { name: "default", nameOffset: first.start, nameLength: 1, params: [], paramsOffset: first.start, paramsLength: 0, ...(defaultNarrowing.length ? { narrowing: defaultNarrowing } : {}) }));
  }
  for (const item of named) {
    const entry = item.entry.name === "default" && defaultNarrowing.length ? { ...item.entry, narrowing: defaultNarrowing } : item.entry;
    result.push(compileSnippet(withoutFormattingEdges(item.node.childNodes ?? []), context, entry));
  }
  return result;
}

/**
 * The content of a `<snippet>` without the whitespace with a line break at its edges: a formatter
 * puts it on its own lines, and that text would reach wherever the child renders the snippet, such
 * as the middle of a sentence (`<code>.meeko</code>.`). A space on the same line is content, and so
 * is a non-breaking space, which `\s` would match: only ASCII whitespace is formatting.
 */
function withoutFormattingEdges(nodes: readonly TemplateNode[]): readonly TemplateNode[] {
  const formatting = (node: TemplateNode): boolean => node.nodeName === "#text" && /^[ \t\r\n\f]*\n[ \t\r\n\f]*$/.test(node.value ?? "");
  let start = 0;
  let end = nodes.length;
  while (start < end && formatting(nodes[start]!)) start++;
  while (end > start && formatting(nodes[end - 1]!)) end--;
  return nodes.slice(start, end);
}

/** `<render snippet="expression" args="a, b" />`: places a snippet that this component received. */
function renderSnippetTag(node: TemplateNode, bindings: TemplateBindings, context: TemplateContext): string {
  const fail = (message: string, offset: number): never => { throw compileError(context.source, context.filename, "MEEK062", message, offset); };
  for (const attribute of node.attrs ?? []) {
    if (attribute.name !== "snippet" && attribute.name !== "args") fail(`<render> admite snippet y args; ${attribute.name} no se admite`, attribute.start);
  }
  const snippetAttribute = node.attrs?.find((attribute) => attribute.name === "snippet");
  if (!snippetAttribute?.value.trim()) fail("<render> necesita snippet=\"expression\", como <render snippet=\"snippets.title\" />", snippetAttribute?.start ?? node.start);
  if ((node.childNodes ?? []).some(isContent)) fail("<render> no admite contenido; escribe <render snippet=\"...\" />", node.start);
  const snippet = snippetAttribute!.value;
  const snippetOffset = attributeValueOffset(node, "snippet", context);
  validateExpression(snippet, context.source, context.filename, snippetOffset);
  const argsAttribute = node.attrs?.find((attribute) => attribute.name === "args");
  const args = argsAttribute?.value.trim() ? argsAttribute.value : undefined;
  const argsOffset = args === undefined ? node.start : attributeValueOffset(node, "args", context);
  if (args !== undefined) validateExpression(args, context.source, context.filename, argsOffset);
  const id = context.nextRegion++;
  bindings.renders.push({ id, snippet, snippetOffset, ...(args !== undefined ? { args } : {}), argsOffset, offset: node.start });
  const list = args === undefined ? markSource("[]", node.start, "<render".length) : markSource(`[${markSource(args, argsOffset)}]`, argsOffset, args.length);
  return `__meeko.renderSnippet(${id}, ${markSource(snippet, snippetOffset)}, ${list})`;
}

/**
 * The element as scoped selectors see it: the static attributes it renders and the attributes
 * that `bind:`, `model` or a `<select model>` may change. `ref:` and `on:` hand the element to
 * the script, and a custom element manages its own attributes: those are open to any class or
 * attribute.
 */
function scopeCandidate(node: TemplateNode, tag: string, custom: boolean, model: boolean, modelSelected: boolean, directives: ReadonlyArray<object | undefined>): ScopeCandidate {
  const attributes = new Map<string, string>();
  const dynamic = new Set<string>();
  let open = custom;
  for (const attribute of node.attrs ?? []) {
    // `bind="obj"` may write any class or attribute.
    if (isRefDirective(attribute) || attribute.name.startsWith("on:") || attribute.name === "bind") open = true;
    else if (attribute.name.startsWith("bind:")) dynamic.add(attribute.name.slice(5).toLowerCase());
    else if (!directives.includes(attribute)) attributes.set(attribute.name.toLowerCase(), attribute.value);
  }
  if (model) dynamic.add("value").add("checked");
  if (modelSelected) dynamic.add("selected");
  return { tag: tag.toLowerCase(), attributes, dynamic, open };
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

interface ScriptParts {
  imports: string[];
  types: string[];
  setup: string[];
  names: string[];
  /** Offset in the `.meeko` source of each setup binding's declared name. */
  declarations: ReadonlyMap<string, number>;
  propsType: string;
  propsTypeOffset: number | undefined;
  defaults?: PropsDefaultsCode;
  emits?: { type: string; offset: number };
  exposed: boolean;
  /** Refs that the script reads with `useElementRef`, by name. */
  usedRefs: ReadonlySet<string>;
  /** Names declared from the first browser `await` on, with their offsets. */
  continuationNames: ReadonlyMap<string, number>;
  /** `defineModel` declarations: model name, value type and whether it has a default. */
  models: Array<{ name: string; type: string; typeOffset: number; optional: boolean }>;
  /** Type argument of `defineSnippets`. */
  snippets?: { type: string; offset: number };
  /** The synchronous setup has a data `await` (`await useApi`, `await useRpcQuery`). */
  dataAwait: boolean;
  warnings: CompileDiagnostic[];
  /** Name of the `defineProps` binding; `__meeko_props` when the script destructures it. */
  propsName?: string;
  /** Names of a destructured `defineProps`, by local name, with the prop each one reads. */
  propAliases?: ReadonlyMap<string, string>;
  /** Default values of `defineProps` as written, by prop, for `ComponentDefaults`. */
  defaultTexts?: ReadonlyMap<string, string>;
  /** The setup returns `__meeko_borrowed`: signals of `defineModel` or of a destructuring, which state snapshots skip. */
  borrows: boolean;
}

/** Type of the value a `ref:` directive publishes. */
function refType(ref: RefBinding): string {
  if (ref.target.kind === "element") return `__meeko.ElementOf<${ref.target.tagType ?? quote(ref.target.tag)}, ${ref.target.svg}>`;
  if (ref.target.kind === "dynamic") return `__meeko.DynamicRefOf<ReturnType<typeof __meeko_is_${ref.id}>>`;
  const reference = ref.target.reference.trim();
  // `typeof` needs an entity name; another expression gives the exposed values no static type.
  return /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*$/.test(reference) ? `__meeko.ExposedOf<typeof ${reference}>` : "unknown";
}

function compileScript(section: SfcSection, source: string, filename: string, hot: boolean, refs: ReadonlyMap<string, RefBinding>, generic: GenericParameters | undefined): ScriptParts {
  /** Argumentos de tipo de los tipos de módulo de un componente genérico, como `<T>`. */
  const typeArgs = generic ? `<${generic.names.join(", ")}>` : "";
  const genericNames = new Set(generic?.names ?? []);
  /** MEEK100: una declaración de tipo pasa al nivel de módulo, donde no existen los parámetros de `generic`. */
  const hoisted = (statement: ts.Statement): void => {
    const reference = genericNames.size ? genericReference(statement, genericNames) : undefined;
    if (!reference) return;
    throw compileError(source, filename, "MEEK100", `Esta declaración de tipo usa ${reference.text}, un parámetro de generic, pero los tipos del script se declaran a nivel de módulo, donde ${reference.text} no existe; escríbela en el argumento de la macro (defineProps<{ rows: ${reference.text}[] }>()) o hazla genérica (type Rows<${reference.text}> = ...) y pásale ${reference.text}`, section.contentStart + reference.getStart(file));
  };
  const file = ts.createSourceFile(filename, section.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] };
  const syntaxError = file.parseDiagnostics[0];
  if (syntaxError) {
    const message = ts.flattenDiagnosticMessageText(syntaxError.messageText, "\n");
    throw compileError(source, filename, "MEEK013", message, section.contentStart + (syntaxError.start ?? 0));
  }
  let composables: ScriptComposables;
  try {
    composables = analyzeComposables(file);
  } catch (error) {
    if (!(error instanceof ComposableError) && !(error instanceof ElementRefError)) throw error;
    throw compileError(source, filename, error.code, error.message, section.contentStart + error.node.getStart(file));
  }
  const split = composables.split ?? file.statements.length;
  const dataAwait = [...composables.awaits.values()].some((site) => file.statements.indexOf(site.statement) < split);
  let propsName: string | undefined;
  const editsFor = new Map<ts.Statement, StatementEdit[]>();
  const statementOf = (node: ts.Node): ts.Statement => {
    let current = node;
    while (!ts.isSourceFile(current.parent)) current = current.parent;
    return current as ts.Statement;
  };
  const edit = (node: ts.Node, change: StatementEdit): void => {
    const statement = statementOf(node);
    const list = editsFor.get(statement) ?? [];
    list.push(change);
    editsFor.set(statement, list);
  };
  const usedRefs = new Set<string>();
  for (const call of composables.elementRefs) {
    let ref: RefBinding;
    try {
      ref = resolveElementRef(call, refs);
    } catch (error) {
      if (!(error instanceof ElementRefError)) throw error;
      throw compileError(source, filename, error.code, error.message, section.contentStart + error.node.getStart(file));
    }
    usedRefs.add(call.name);
    const depth = nodeDepth(call.call, statementOf(call.call)) * 2 + 1;
    const callee = call.call.expression;
    edit(call.call, { kind: "remove", start: callee.getStart(file), end: callee.getEnd() });
    edit(call.call, { kind: "insert", at: callee.getStart(file), text: `__meeko.${ref.list ? "elementListRef" : "elementRef"}<__MeekoRefs[${quote(call.name)}]>`, depth, closing: false });
    edit(call.call, { kind: "insert", at: call.nameNode.getEnd(), text: `, __meeko_refs, ${ref.id}`, depth, closing: true });
  }
  for (const site of composables.awaits.values()) {
    const index = file.statements.indexOf(site.statement);
    const depth = nodeDepth(site.node, site.statement) * 2;
    const operand = site.node.expression;
    if (index < split) {
      // The synchronous setup reads loaded data at once, or suspends the render.
      edit(site.node, { kind: "remove", start: site.node.getStart(file), end: operand.getStart(file) });
      edit(site.node, { kind: "insert", at: operand.getStart(file), text: "__meeko.awaitData(", depth, closing: false });
      edit(site.node, { kind: "insert", at: operand.getEnd(), text: ")", depth, closing: true });
    } else {
      // The browser continuation leaves the component root while it waits and resumes it after.
      edit(site.node, { kind: "insert", at: site.node.getStart(file), text: "__meeko_ctx.resume(", depth, closing: false });
      edit(site.node, { kind: "insert", at: operand.getStart(file), text: "__meeko_ctx.wait(", depth: depth + 1, closing: false });
      edit(site.node, { kind: "insert", at: operand.getEnd(), text: ")", depth: depth + 1, closing: true });
      edit(site.node, { kind: "insert", at: site.node.getEnd(), text: ")", depth, closing: true });
    }
  }
  const continuation: string[] = [];
  const continuationNames = new Map<string, number>();
  let emitsDeclaration: EmitsDeclaration | undefined;
  try {
    emitsDeclaration = analyzeEmits(file);
  } catch (error) {
    if (!(error instanceof EmitsError)) throw error;
    throw compileError(source, filename, error.code, error.message, section.contentStart + error.node.getStart(file));
  }
  let exposeDeclaration: ExposeDeclaration | undefined;
  try {
    exposeDeclaration = analyzeExpose(file);
  } catch (error) {
    if (!(error instanceof ExposeError)) throw error;
    throw compileError(source, filename, error.code, error.message, section.contentStart + error.node.getStart(file));
  }
  let modelDeclarations: ModelDeclaration[];
  let snippetsDeclaration: SnippetsDeclaration | undefined;
  try {
    modelDeclarations = analyzeModels(file);
    snippetsDeclaration = analyzeSnippets(file);
  } catch (error) {
    if (!(error instanceof ModelError) && !(error instanceof SnippetsError)) throw error;
    throw compileError(source, filename, error.code, error.message, section.contentStart + error.node.getStart(file));
  }
  const models: ScriptParts["models"] = [];
  let snippets: ScriptParts["snippets"];
  /** Replaces a macro declaration, mapped to its whole statement. */
  const macroStatement = (declaration: ts.VariableDeclaration, text: string): string => {
    const start = declaration.parent.parent.getStart(file);
    return markSource(text, section.contentStart + start, declaration.parent.parent.getEnd() - start);
  };
  let emitIndex: number | undefined;
  const imports: string[] = [];
  const types: string[] = [];
  const setup: string[] = [];
  const names: string[] = [];
  /** Destructured setup bindings, which the setup marks as borrowed. */
  const unowned: string[] = [];
  const declarations = new Map<string, number>();
  /**
   * MEEK015: los identificadores que declara una declaración de variable. Una desestructuración
   * no puede recibir una macro ni una ref: su resultado debe tener un nombre simple.
   */
  const declaredIdentifiers = (declaration: ts.VariableDeclaration): ts.Identifier[] => {
    const found: ts.Identifier[] = [];
    if (ts.isIdentifier(declaration.name)) return [declaration.name];
    let initializer = declaration.initializer;
    while (initializer && (ts.isParenthesizedExpression(initializer) || ts.isAwaitExpression(initializer) || ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer) || ts.isNonNullExpression(initializer))) initializer = initializer.expression;
    const callee = initializer && ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) ? initializer.expression.text : undefined;
    try {
      validateElementRefBinding(callee, declaration.name);
    } catch (error) {
      if (!(error instanceof ElementRefError)) throw error;
      throw compileError(source, filename, error.code, error.message, section.contentStart + error.node.getStart(file));
    }
    bindingIdentifiers(declaration.name, found);
    return found;
  };
  let propsType: string | undefined;
  let propsTypeOffset: number | undefined;
  let propsInterfaceWarning: CompileDiagnostic | undefined;
  let defaults: PropsDefaultsCode | undefined;
  let propAliases: Map<string, string> | undefined;
  let defaultTexts: Map<string, string> | undefined;
  /** The `...rest` of a destructured `defineProps`. */
  let restName: string | undefined;
  // En desarrollo con `hot`, DevTools registra escrituras `.value` y lecturas de `computed`; producción y SSR sin `hot` no cambian.
  const setupStatement = (statement: ts.Statement): string => {
    const original = statement.getText(file);
    const edits = editsFor.get(statement);
    const instrumented = hot || edits
      ? instrumentNode(file, statement, (position) => section.contentStart + position, { source, filename }, { computed: true, devtools: hot, ...(edits ? { edits } : {}) })
      : undefined;
    return markSource(instrumented ?? original, section.contentStart + statement.getStart(file), original.length);
  };
  /**
   * An expression or control-flow statement of the setup or of the continuation: `defineProps`
   * only works in its own declaration (MEEK016), and a top-level-only composable inside `if`, a
   * loop, `try`, `switch` or a block would run conditionally or repeatedly (MEEK054).
   */
  const checkExecutable = (statement: ts.Statement): void => {
    const props = definePropsCall(statement);
    if (props) {
      throw compileError(source, filename, "MEEK016", "defineProps debe aparecer una sola vez, en su propia declaración const de nivel superior, como const props = defineProps<Props>()", section.contentStart + props.getStart(file));
    }
    const composable = conditionalComposable(statement);
    if (composable) {
      throw compileError(source, filename, "MEEK054", `${composable.expression.getText(file)}() debe llamarse sin condiciones en el nivel superior de <script>, no dentro de if, de un bucle, de try, de switch ni de un bloque`, section.contentStart + composable.expression.getStart(file));
    }
  };
  /** A `defineProps` declaration, `const props = defineProps<Props>()` or a destructuring of it. */
  const declareProps = (declaration: ts.VariableDeclaration, name: string, pattern: PropsPattern | undefined): void => {
    if (propsType) throw compileError(source, filename, "MEEK016", "defineProps debe aparecer una sola vez, en su propia declaración", section.contentStart + declaration.getStart(file));
    const call = definePropsInitializer(declaration)!;
    const typeArgument = call.typeArguments?.[0];
    propsType = typeArgument?.getText(file);
    if (!propsType) throw compileError(source, filename, "MEEK017", "defineProps necesita un argumento de tipo", section.contentStart + declaration.getStart(file));
    propsTypeOffset = section.contentStart + typeArgument!.getStart(file);
    const nonstandard = nonstandardLocalPropsInterface(call, file);
    if (nonstandard) propsInterfaceWarning = {
      code: "MEEK120", filename, location: locate(source, section.contentStart + nonstandard.getStart(file)), severity: "warning",
      message: `La interfaz local de defineProps se llama ${nonstandard.text}; usa interface Props para mantener una convención consistente entre componentes`,
    };
    propsName = name;
    defaultTexts = propsDefaultTexts(declaration, file);
    const at = (node: ts.Node): number => section.contentStart + node.getStart(file);
    try {
      const analyzed = analyzePropsDeclaration(call).defaults;
      const patternDefaults = pattern?.bindings.filter((binding) => binding.initializer !== undefined) ?? [];
      if (analyzed && patternDefaults.length) {
        throw new PropsDefaultsError("MEEK124", `Los valores por defecto van en la desestructuración o en el argumento de defineProps, no en los dos: escríbelos en la desestructuración, como ${patternDefaults[0]!.name.text} = …, y quita el argumento`, analyzed.argument);
      }
      const values = analyzed
        ? analyzed.argument.properties.flatMap((property) => ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? [{ key: property.name.text, value: property.initializer }] : [])
        : patternDefaults.map((binding) => ({ key: binding.key, value: binding.initializer! }));
      // Constants of the script that the defaults read are evaluated again with them, before the setup.
      const constants = propsDefaultsConstants(file, values).map((constant) => constant.getText(file));
      // A literal default is optional only in the members of a union that admit it; another one is
      // checked on its prop's name (MEEK131).
      const literals = Object.fromEntries(propsDefaultLiteralTypes(declaration, file));
      const keyNodes = analyzed
        ? analyzed.argument.properties.flatMap((property) => ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? [[property.name.text, property.name] as const] : [])
        : patternDefaults.map((binding) => [binding.key, binding.keyNode] as const);
      const keyRanges = Object.fromEntries(keyNodes.map(([key, node]) => [key, [at(node), node.getWidth(file)] as const]));
      const typing = { literals, keyRanges };
      if (analyzed) defaults = {
        expression: analyzed.argument.getText(file),
        offset: at(analyzed.argument),
        keys: analyzed.keys,
        ...(constants.length ? { constants } : {}),
        ...typing,
      };
      else if (patternDefaults.length) defaults = {
        expression: `{ ${patternDefaults.map((binding) => `${markSource(quote(binding.key), at(binding.keyNode), binding.keyNode.getWidth(file))}: ${markSource(binding.initializer!.getText(file), at(binding.initializer!))}`).join(", ")} }`,
        offset: at(declaration.name),
        keys: patternDefaults.map((binding) => binding.key),
        marked: true,
        ...(constants.length ? { constants } : {}),
        ...typing,
      };
    } catch (error) {
      if (!(error instanceof PropsDefaultsError)) throw error;
      throw compileError(source, filename, error.code, error.message, section.contentStart + error.node.getStart(file));
    }
    // Readonly: the props view throws on any write, so an assignment is a type error (TS2540).
    // An assertion, so that `unknown` props reach their own check (MEEK_PAGE_PROPS…).
    // Since 1.8 the callbacks of the declared events (`onClick`) are not among its keys: the
    // type does not declare them, and `const { a, ...rest } = props` must not carry them.
    const events = emitsDeclaration ? emitNames(emitsDeclaration.typeArgument, file) : undefined;
    // A map that the script does not spell (`defineEmits<ButtonEmits>()`) is only known at run time.
    const propsSource = emitsDeclaration && !events ? "__meeko.withoutEventProps(__props, null)"
      : events?.length ? `__meeko.withoutEventProps(__props, ${JSON.stringify(events.map(emitPropName))})` : "__props";
    // Each destructured prop must exist in every member of the props, as in a TypeScript
    // destructuring (`TS2344` on its name); the check is `unknown`, so the type stays the same.
    const keysCheck = pattern?.bindings.length
      ? ` & __meeko.PropKeysCheck<[${pattern.bindings.map((binding) => `__meeko.PropKey<${propsType}, ${markSource(quote(binding.key), at(binding.keyNode), binding.keyNode.getWidth(file))}>`).join(", ")}]>`
      : "";
    setup.push(`const ${name} = ${propsSource} as Readonly<${defaults ? `__MeekoResolvedProps${typeArgs}` : markSource(propsType, propsTypeOffset)}>${keysCheck};`);
    if (!pattern) return;
    propAliases = new Map(pattern.bindings.map((binding) => [binding.name.text, binding.key]));
    names.push(name);
    if (pattern.rest) {
      const rest = pattern.rest;
      restName = rest.text;
      const keys = pattern.bindings.map((binding) => binding.key);
      names.push(rest.text);
      declarations.set(rest.text, at(rest));
      setup.push(`const ${markSource(rest.text, at(rest))} = __meeko.restProps(${name}, ${JSON.stringify(keys)}) as __meeko.RestProps<typeof ${name}, ${keys.map(quote).join(" | ") || "never"}>;`);
    }
  };
  for (const [index, statement] of file.statements.entries()) {
    if (ts.isImportDeclaration(statement)) {
      imports.push(markSource(statement.getText(file), section.contentStart + statement.getStart(file)));
      continue;
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      hoisted(statement);
      types.push(markSource(statement.getText(file), section.contentStart + statement.getStart(file)));
      continue;
    }
    if (ts.isExportDeclaration(statement) && (statement.isTypeOnly ||
      (statement.exportClause && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.every((element) => element.isTypeOnly)))) {
      hoisted(statement);
      types.push(markSource(statement.getText(file), section.contentStart + statement.getStart(file)));
      continue;
    }
    if (exportsValue(statement)) {
      throw compileError(source, filename, "MEEK018", `Export de nivel superior no admitido en el script: ${unsupportedStatementHint(statement)}`, section.contentStart + statement.getStart(file));
    }
    if (index >= split) {
      // From the first browser await on, statements run in the browser after the component mounts.
      const macro = macroCall(statement, file, emitsDeclaration, exposeDeclaration, modelDeclarations, snippetsDeclaration);
      if (macro) {
        throw compileError(source, filename, "MEEK058", `${macro} debe ir antes del primer await de navegador (await useElementRef o await useSocket), tras el cual el código sólo continúa en el navegador`, section.contentStart + statement.getStart(file));
      }
      if (ts.isVariableStatement(statement)) {
        if (statement.declarationList.declarations.length !== 1) throw compileError(source, filename, "MEEK014", "Declara una variable por sentencia en los scripts .meeko", section.contentStart + statement.getStart(file));
        const declaration = statement.declarationList.declarations[0]!;
        // Destructured names are browser-only bindings like the others after the first browser await.
        for (const identifier of declaredIdentifiers(declaration)) continuationNames.set(identifier.text, section.contentStart + identifier.getStart(file));
      } else if (ts.isFunctionDeclaration(statement) && statement.name) {
        continuationNames.set(statement.name.text, section.contentStart + statement.name.getStart(file));
      } else if (isExecutableStatement(statement)) {
        // The continuation is an async function: assignments, calls and control flow run there.
        checkExecutable(statement);
      } else {
        throw compileError(source, filename, "MEEK018", `Sentencia de script no admitida tras el primer await de navegador: ${ts.SyntaxKind[statement.kind]}; ${unsupportedStatementHint(statement)}`, section.contentStart + statement.getStart(file));
      }
      continuation.push(setupStatement(statement));
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      if (statement.declarationList.declarations.length !== 1) throw compileError(source, filename, "MEEK014", "Declara una variable por sentencia en los scripts .meeko", section.contentStart + statement.getStart(file));
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) && definePropsInitializer(declaration)) {
          // `const { label, size = "md", class: className, ...rest } = defineProps<Props>()`: each
          // name reads its prop wherever it is used (see `rewritePropAliases`), and `rest` is a view.
          let pattern: PropsPattern;
          try { pattern = analyzePropsPattern(declaration); }
          catch (error) {
            if (!(error instanceof PropsDefaultsError)) throw error;
            throw compileError(source, filename, error.code, error.message, section.contentStart + error.node.getStart(file));
          }
          declareProps(declaration, "__meeko_props", pattern);
          continue;
        }
        if (!ts.isIdentifier(declaration.name)) {
          // `const { a, b: c = 1, ...rest } = value` and `const [a, , b] = value`: each name is a
          // setup binding. Its value belongs to whatever returned it, so state snapshots skip it.
          for (const identifier of declaredIdentifiers(declaration)) {
            names.push(identifier.text);
            unowned.push(identifier.text);
            declarations.set(identifier.text, section.contentStart + identifier.getStart(file));
          }
          setup.push(setupStatement(statement));
          continue;
        }
        const name = declaration.name.text;
        names.push(name);
        declarations.set(name, section.contentStart + declaration.name.getStart(file));
        const modelDeclaration = modelDeclarations.find((model) => model.declaration === declaration);
        if (modelDeclaration) {
          const type = modelDeclaration.typeArgument.getText(file);
          models.push({ name: modelDeclaration.name, type, typeOffset: section.contentStart + modelDeclaration.typeArgument.getStart(file), optional: modelDeclaration.options !== undefined });
          const value = `__MeekoModels${typeArgs}[${quote(modelDeclaration.name)}]`;
          const options = modelDeclaration.options ? `, ${markSource(modelDeclaration.options.getText(file), section.contentStart + modelDeclaration.options.getStart(file))}` : "";
          setup.push(macroStatement(declaration, `const ${name}: __meeko.Signal<${value}> = __meeko.useModel<${value}>(__props, ${quote(modelDeclaration.name)}, __meeko_borrowed${options});`));
        } else if (declaration === snippetsDeclaration?.declaration) {
          snippets = { type: snippetsDeclaration.typeArgument.getText(file), offset: section.contentStart + snippetsDeclaration.typeArgument.getStart(file) };
          // An intersection with a mapped type is read member by member (see `snippetTypeParts`).
          const parts = snippetTypeParts(snippetsDeclaration.typeArgument, file);
          const map = parts
            ? parts.map((part) => `__meeko.SnippetMap<${markSource(part.getText(file), section.contentStart + part.getStart(file))}>`).join(" & ")
            : `__meeko.SnippetMap<__MeekoSnippets${typeArgs}>`;
          // The same object; TypeScript cannot relate the whole map to its members over a type parameter.
          const value = `__meeko.useSnippets<__MeekoSnippets${typeArgs}>(__props)${parts ? ` as unknown as ${map}` : ""}`;
          setup.push(macroStatement(declaration, `const ${name}: ${map} = ${value};`));
        } else if (declaration === emitsDeclaration?.declaration) {
          // The statement needs to know whether defineProps exists, which may come later.
          emitIndex = setup.length;
          setup.push("");
        } else if (definePropsInitializer(declaration)) {
          declareProps(declaration, name, undefined);
        } else {
          setup.push(setupStatement(statement));
        }
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.push(statement.name.text);
      declarations.set(statement.name.text, section.contentStart + statement.name.getStart(file));
      setup.push(setupStatement(statement));
      continue;
    }
    if (statement === exposeDeclaration?.statement) {
      // The value stays in the setup scope; the component returns it under a symbol key.
      setup.push(`const __meeko_exposed = __meeko.${setupStatement(statement)}`);
      continue;
    }
    if (isExecutableStatement(statement)) {
      // Calls, assignments and control flow run in order, in SSR and on hydration alike, before
      // the template reads the bindings; a hydration restores the state snapshot after them.
      checkExecutable(statement);
      setup.push(setupStatement(statement));
      continue;
    }
    throw compileError(source, filename, "MEEK018", `Sentencia de nivel superior no admitida en el script: ${ts.SyntaxKind[statement.kind]}; ${unsupportedStatementHint(statement)}`, section.contentStart + statement.getStart(file));
  }
  // Values at the end of the synchronous setup, the ones it returns.
  if (unowned.length) setup.push(`for (const __meeko_value of [${unowned.join(", ")}]) __meeko_borrowed.add(__meeko_value);`);
  if (continuation.length) {
    setup.push(`__meeko.continueInBrowser(async (__meeko_ctx: __meeko.BrowserContinuation) => {\ntry {\n${continuation.join("\n")}\n} finally { __meeko_ctx.exit(); }\n});`);
  }
  let emits: { type: string; offset: number } | undefined;
  if (emitsDeclaration && emitIndex !== undefined) {
    const { declaration, typeArgument } = emitsDeclaration;
    emits = { type: typeArgument.getText(file), offset: section.contentStart + typeArgument.getStart(file) };
    // A defineProps callback with the same name fails here, on the defineEmits type argument.
    const conflict = propsType ? `, ${markSource(`__meeko.NoEmitConflict<__MeekoDeclaredProps${typeArgs}, __MeekoEmits${typeArgs}>`, emits.offset, emits.type.length)}` : "";
    const statement = `const ${declaration.name.text}: __meeko.Emit<__MeekoEmits${typeArgs}> = __meeko.createEmit<__MeekoEmits${typeArgs}${conflict}>(__props);`;
    const start = declaration.parent.parent.getStart(file);
    setup[emitIndex] = markSource(statement, section.contentStart + start, declaration.parent.parent.getEnd() - start);
  }
  const borrows = models.length > 0 || unowned.length > 0;
  if (borrows) setup.unshift("const __meeko_borrowed = new Set<unknown>();");
  // MEEK101: with reactive props the child stays mounted, so a read that runs once keeps the first
  // value. A component with a top-level data await is still mounted again, so its reads stay fresh.
  const reads = !propsName || dataAwait ? []
    : propAliases ? [...propAliasReadsOnce(file, new Set(propAliases.keys())), ...restName ? propsReadsOnce(file, restName) : []].sort((left, right) => left.start - right.start)
    : propsReadsOnce(file, propsName);
  const warnings: CompileDiagnostic[] = reads.map((read): CompileDiagnostic => ({
    code: "MEEK101", message: read.message, filename, location: locate(source, section.contentStart + read.start), severity: "warning",
  }));
  if (propsInterfaceWarning) warnings.push(propsInterfaceWarning);
  return { borrows, imports, types, setup, names, declarations, propsType: propsType ?? "Record<string, never>", propsTypeOffset, ...(defaults ? { defaults } : {}), ...(emits ? { emits } : {}), exposed: exposeDeclaration !== undefined, usedRefs, continuationNames, models, ...(snippets ? { snippets } : {}), dataAwait, ...(propsName ? { propsName } : {}), ...(propAliases ? { propAliases } : {}), ...(defaultTexts?.size ? { defaultTexts } : {}), warnings };
}

/**
 * `generic` del `<script lang="ts">` del componente. MEEK100 si la lista no es válida, si está en
 * `<script server>` o si el componente es una página, cuyas props pasa el propio Meeko.
 */
function scriptGeneric(source: string, filename: string, script: SfcSection, server: SfcSection | undefined): GenericParameters | undefined {
  const misplaced = server && sectionAttribute(source, server, "generic");
  if (misplaced) throw compileError(source, filename, "MEEK100", "generic va en el <script lang=\"ts\"> del componente, no en <script server>", misplaced.start);
  const attribute = sectionAttribute(source, script, "generic");
  if (!attribute) return undefined;
  if (server) {
    throw compileError(source, filename, "MEEK100", "Una página no puede ser genérica: Meeko le pasa sus props y no puede elegir sus parámetros de tipo; quita generic o lleva el contenido genérico a un componente", attribute.start);
  }
  try { return parseGeneric(attribute.value, attribute.offset); }
  catch (error) {
    if (!(error instanceof GenericError)) throw error;
    throw compileError(source, filename, "MEEK100", error.message, error.offset);
  }
}

/**
 * Etiquetas de componente con `ref:`, a cualquier profundidad de la plantilla, por su ref, con las
 * condiciones `if:when` que las rodean cuando el módulo es para `meeko check`.
 */
function taggedRefs(bindings: TemplateBindings, narrow: boolean): Map<RefBinding, { entry: ComponentBinding; guards: readonly Guard[] }> {
  const found = new Map<RefBinding, { entry: ComponentBinding; guards: readonly Guard[] }>();
  const visit = (current: TemplateBindings, guards: readonly Guard[]): void => {
    for (const entry of current.components) {
      if (entry.ref) found.set(entry.ref, { entry, guards });
      for (const snippet of entry.snippets) visit(snippet.bindings, unshadowed(guards, snippet.params));
    }
    for (const region of current.regions) {
      if (region.kind === "list") visit(region.bindings, unshadowed(guards, [region.itemName, region.indexName]));
      else if (region.kind === "teleport") visit(region.bindings, guards);
      else visit(region.bindings, narrow ? [...guards, { code: region.build ? region.build(markSource) : markSource(region.expression, region.offset), names: namesOf(region.expression) }] : guards);
    }
  };
  visit(bindings, []);
  return found;
}

/** A top-level value export: the script of a component only exports types. */
function exportsValue(statement: ts.Statement): boolean {
  if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) return true;
  return ts.canHaveModifiers(statement) && (ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

/** MEEK018: what to write instead of a top-level statement that the script does not run. */
function unsupportedStatementHint(statement: ts.Statement): string {
  if (exportsValue(statement)) {
    return "el script de un componente sólo exporta tipos (export interface, export type); quita export, porque la plantilla ya ve las declaraciones del nivel superior. Los datos de una página se exportan desde <script server>";
  }
  if (ts.isClassDeclaration(statement)) return "declara la clase en un módulo .ts e impórtala; el setup se ejecuta una vez por instancia del componente";
  if (ts.isEnumDeclaration(statement)) return "usa una unión de literales (type Status = \"idle\" | \"busy\") o declara el enum en un módulo .ts e impórtalo";
  if (ts.isModuleDeclaration(statement)) return "declara el namespace en un módulo .ts o en un archivo .d.ts";
  if (ts.isImportEqualsDeclaration(statement)) return "usa import ... from";
  if (ts.isReturnStatement(statement)) return "el setup no devuelve nada: la plantilla ve las declaraciones del nivel superior; para omitir código, ponlo dentro de un if";
  if (ts.isThrowStatement(statement)) return "un throw incondicional haría fallar siempre el componente; ponlo dentro de un if o de una función";
  if (ts.isBreakOrContinueStatement(statement)) return "break y continue sólo funcionan dentro de un bucle, de un switch o de una sentencia etiquetada";
  return "usa declaraciones, funciones, expresiones, if, bucles, try, switch o bloques";
}

/** Name of the compiler macro a statement calls: defineProps, defineEmits, defineExpose, defineModel or defineSnippets. */
function macroCall(statement: ts.Statement, file: ts.SourceFile, emits: EmitsDeclaration | undefined, expose: ExposeDeclaration | undefined, models: readonly ModelDeclaration[], snippets: SnippetsDeclaration | undefined): string | undefined {
  if (statement === expose?.statement) return "defineExpose";
  if (!ts.isVariableStatement(statement)) return undefined;
  for (const declaration of statement.declarationList.declarations) {
    if (declaration === emits?.declaration) return "defineEmits";
    if (models.some((model) => model.declaration === declaration)) return "defineModel";
    if (declaration === snippets?.declaration) return "defineSnippets";
    if (definePropsInitializer(declaration)) return "defineProps";
  }
  return undefined;
}

function hydrationBody(bindings: TemplateBindings, context: TemplateContext, hot: boolean, locals: ReadonlyMap<string, string> = new Map(), guards: readonly Guard[] = []): string {
  const statements: string[] = [];
  const plainExpression = (expression: string, offset: number, expressionLocals = locals): string =>
    markSource(rewriteLocals(expression, expressionLocals, offset), offset, expression.length);
  // Behind the `if:when` conditions around it (`meeko check` only), mapped to the expression.
  const mappedExpression = (expression: string, offset: number, expressionLocals = locals, within = guards): string => {
    const code = plainExpression(expression, offset, expressionLocals);
    return within.length ? markSource(narrowed(code, within), offset, expression.length) : code;
  };
  // Los paréntesis evitan que `() => { ... }.value` se lea como bloque; su tramo externo conserva la ubicación.
  const arrowExpression = (expression: string, offset: number, expressionLocals = locals, within = guards): string =>
    markSource(`(${mappedExpression(expression, offset, expressionLocals, within)})`, offset, expression.length);
  // `<MeekoOutlet>` reads a generated expression that maps to the tag name, not to its own text.
  const componentReference = (entry: ComponentBinding): string => entry.referenceLength === undefined
    ? arrowExpression(entry.reference, entry.referenceOffset)
    : markSource(`(${entry.reference})`, entry.referenceOffset, entry.referenceLength);
  for (const { id, expression, offset } of bindings.texts) {
    const point = locate(context.source, offset);
    const location = `${basename(context.filename)}:${point.line}:${point.column} (text ${id})`;
    const source = hot ? `, { file: ${quote(context.filename)}, line: ${point.line}, column: ${point.column}, expression: ${quote(expression)}, kind: "text" }` : "";
    statements.push(`__meeko_cleanups.push(__meeko.bindText(__scope, ${id}, () => ${arrowExpression(expression, offset)}, ${quote(location)}${source}));`);
  }
  for (const { id, expression, offset } of bindings.htmls) {
    const point = locate(context.source, offset);
    const location = `${basename(context.filename)}:${point.line}:${point.column} (html ${id})`;
    const source = hot ? `, { file: ${quote(context.filename)}, line: ${point.line}, column: ${point.column}, expression: ${quote(expression)}, kind: "text" }` : "";
    statements.push(`__meeko_cleanups.push(__meeko.bindHtml(__scope, ${id}, () => ${arrowExpression(expression, offset)}, ${quote(location)}${source}));`);
  }
  for (const { id, name, expression, offset, build } of bindings.attributes) {
    const point = locate(context.source, offset);
    const location = `${basename(context.filename)}:${point.line}:${point.column} (attribute ${name})`;
    const source = hot ? `, { file: ${quote(context.filename)}, line: ${point.line}, column: ${point.column}, expression: ${quote(expression)}, kind: "attribute" }` : "";
    const value = build ? `(${build((part, partOffset) => mappedExpression(part, partOffset))})` : arrowExpression(expression, offset);
    statements.push(`__meeko_cleanups.push(__meeko.bindAttribute(__scope, ${id}, ${quote(name)}, () => ${value}, ${quote(location)}${source}));`);
  }
  for (const spread of bindings.spreads) {
    const point = locate(context.source, spread.offset);
    const location = `${basename(context.filename)}:${point.line}:${point.column} (bind)`;
    statements.push(`__meeko_cleanups.push(__meeko.bindSpread(__scope, ${spread.id}, () => ${spreadCode(spread, (part, partOffset) => mappedExpression(part, partOffset))}, ${quote(location)}));`);
  }
  for (const { id, name, expression, offset, tag, svg, tagType } of bindings.events) {
    const eventType = templateEventType("__meeko.", name, tag, svg, tagType);
    const handlerExpression = hot ? markSource(rewriteLocals(instrumentTemplateExpression(expression, offset, context), locals), offset, expression.length) : mappedExpression(expression, offset);
    const handler = markSource(`((__meeko_handler: (event: ${eventType}) => unknown) => __meeko_handler(__meeko_event as ${eventType}))(${handlerExpression});`, offset, expression.length);
    statements.push(`{
      __meeko_cleanups.push(__meeko.bindEvent(__scope, ${id}, ${quote(name)}, (__meeko_event: Event) => {
        return ${handler}
      }));
    }`);
  }
  for (const ref of bindings.refs) {
    if (context.usedRefs.has(ref.name)) statements.push(`__meeko_cleanups.push(__meeko.bindElementRef(__scope, __meeko_refs, ${ref.id}, ${ref.element}));`);
  }
  for (const model of bindings.models) {
    const radio = !model.radio ? "" : "code" in model.radio ? `, () => ${model.radio.code}` : `, () => ${arrowExpression(model.radio.expression, model.radio.offset)}`;
    statements.push(`__meeko_cleanups.push(__meeko.bindModel(__scope, ${model.id}, ${quote(model.kind)}, () => ${arrowExpression(model.expression, model.offset)}${radio}));`);
    statements.push(`void (() => __meeko.checkWritableSignal(${mappedExpression(model.expression, model.offset)}));`);
  }
  for (const entry of bindings.renders) {
    // `args` is a list, so the guards go around the whole array.
    const list = entry.args === undefined ? "[]" : `[${plainExpression(entry.args, entry.argsOffset)}]`;
    const args = entry.args !== undefined && guards.length ? markSource(narrowed(list, guards), entry.argsOffset, entry.args.length) : list;
    statements.push(`__meeko_cleanups.push(__meeko.bindSnippet(__scope, ${entry.id}, () => ${arrowExpression(entry.snippet, entry.snippetOffset)}, () => ${args}));`);
  }
  /** A snippet that the parent passes, with the hydration of its content. */
  const snippetValue = (snippet: SnippetBinding): string => {
    // Parameters shadow the parent's locals; in the hydration they read the arguments signal.
    const outer = new Map(locals);
    const inner = new Map(locals);
    snippet.params.forEach((param, index) => {
      outer.delete(param);
      inner.set(param, `__meeko_args_${snippet.id}.value[${index}]`);
    });
    // The content is narrowed by the snippet's own `if:when` too, read with the parent's locals.
    const condition = snippet.condition && context.narrow
      ? [{ code: plainExpression(snippet.condition.expression, snippet.condition.offset), names: namesOf(snippet.condition.expression) }]
      : [];
    // `<MeekoAwait for="items">`: its content reads `items.data.value` as loaded.
    const narrowing = context.narrow
      ? (snippet.narrowing ?? []).map((item) => ({ code: markSource(rewriteLocals(item.expression, locals), item.offset, item.length), names: namesOf(item.expression) }))
      : [];
    return `__meeko.snippet(${snippetParameters(snippet)} => ${rewriteLocals(snippet.render, outer)}, (__meeko_args_${snippet.id}, __scope) => { ${hydrationBody(snippet.bindings, context, hot, inner, unshadowed([...guards, ...condition, ...narrowing], snippet.params))} })`;
  };
  /** The checked props, models and snippets of a component tag, read by its binding. */
  const componentInput = (entry: ComponentBinding, reference: string): string => {
    const props = entry.props.map((prop) => {
      const value = mappedExpression(prop.expression, prop.offset);
      // A static attribute never changes and a function literal reads nothing when evaluated, so
      // DevTools has no read to track; unwrapped, a handler's parameters keep the types that the
      // tag call infers for a generic child.
      return `${markSource(quote(prop.name), prop.nameOffset, prop.nameLength)}: ${hot && !prop.literal && !isFunctionLiteral(prop.expression) ? trackedRead(context, prop.offset, prop.expression, "prop", `(${value})`, prop.name) : value}`;
    });
    if (entry.spread) props.unshift(spreadPropsCode(reference, mappedExpression(entry.spread.expression, entry.spread.offset)));
    const snippets = entry.snippets.map((snippet) => conditionalSnippet(snippetValue(snippet), snippet.condition && mappedExpression(snippet.condition.expression, snippet.condition.offset)));
    return componentTagCall(entry, reference, markSource(`{ ${props.join(", ")} }`, entry.offset, 1),
      entry.models.map((model) => mappedExpression(model.expression, model.offset)), snippets);
  };
  /** Type-only checks of a component tag, never called: a model needs a writable signal; a conditional snippet, an optional one. */
  const componentChecks = (entry: ComponentBinding, reference: string): string[] => {
    const result: string[] = [];
    const writable = entry.models.map((model) => ` __meeko.checkWritableSignal(${mappedExpression(model.expression, model.offset)});`).join("");
    if (writable) result.push(`void (() => {${writable} });`);
    if (context.narrow) for (const snippet of entry.snippets) if (snippet.condition) result.push(snippetConditionCheck(snippet, reference));
    return result;
  };
  const componentStatements: string[] = [];
  for (const entry of bindings.components) {
    const point = locate(context.source, entry.offset);
    const location = `${basename(context.filename)}:${point.line}:${point.column} (component ${entry.reference})`;
    const input = componentInput(entry, componentReference(entry));
    componentStatements.push(`__meeko_cleanups.push(__meeko.bindComponent<any>(__scope, ${entry.id}, () => ${componentReference(entry)}, () => (${input}), ${quote(location)}${entry.ref && context.usedRefs.has(entry.ref.name) ? `, __meeko.refTarget(__meeko_refs, ${entry.ref.id})` : ""}));`);
    componentStatements.push(...componentChecks(entry, componentReference(entry)));
  }
  // `<component is>` with an HTML tag: the element's own bindings hydrate again with a new tag.
  for (const entry of bindings.tags) {
    const point = locate(context.source, entry.offset);
    const location = `${basename(context.filename)}:${point.line}:${point.column} (component ${entry.reference})`;
    const value = branchValue(arrowExpression(entry.reference, entry.referenceOffset), entry.branch, context.narrow);
    componentStatements.push(`__meeko_cleanups.push(__meeko.bindElementTag(__scope, ${entry.element}, () => ${value}, ${entry.content}, (${entry.tagVariable}) => ${rewriteLocals(entry.open, locals)}, (${entry.tagVariable}, __scope) => { ${hydrationBody(entry.bindings, context, hot, locals, guards)} }, ${quote(location)}));`);
    if (context.narrow) componentStatements.push(tagCheck(entry, branchValue(mappedExpression(entry.reference, entry.referenceOffset), entry.branch, true), false));
  }
  for (const entry of bindings.dynamics) {
    const point = locate(context.source, entry.offset);
    const location = `${basename(context.filename)}:${point.line}:${point.column} (component ${entry.reference})`;
    const value = arrowExpression(entry.reference, entry.referenceOffset);
    const component = markSource(`__meeko.componentPart(${value})`, entry.referenceOffset, entry.reference.length);
    const fallback = entry.component.snippets.find((snippet) => snippet.name === "default");
    const open = rewriteLocals(entry.open, locals);
    const html = entry.bindings.htmls[0];
    // The element's content: `html`, or the `default` snippet in its own `<render>` region.
    const contentRender = html ? `__meeko.rawHtml(${arrowExpression(html.expression, html.offset)}, ${entry.tagVariable})`
      : fallback && entry.contentRegion !== undefined ? `__meeko.renderSnippet(${entry.contentRegion}, ${snippetValue(fallback)}, [])` : quote("");
    const hydrateContent = fallback && entry.contentRegion !== undefined && !html
      ? `(__scope) => __meeko.bindSnippet(__scope, ${entry.contentRegion}, () => ${snippetValue(fallback)}, () => [])`
      : "() => () => {}";
    const ref = entry.component.ref && context.usedRefs.has(entry.component.ref.name) ? `, expose: __meeko.refTarget(__meeko_refs, ${entry.component.ref.id})` : "";
    componentStatements.push(`__meeko_cleanups.push(__meeko.bindDynamic(__scope, ${entry.id}, () => ${value}, ${quote(location)}, { element: ${entry.element}, content: ${entry.content}, svg: ${entry.svg}, open: (${entry.tagVariable}) => ${open}, render: (${entry.tagVariable}) => ${open} + ${contentRender} + __meeko.closeTag(${entry.tagVariable}), hydrate: (${entry.tagVariable}, __scope) => { ${hydrationBody(entry.bindings, context, hot, locals, guards)} }, hydrateContent: ${hydrateContent} }, { read: () => (${componentInput(entry.component, component)})${ref} }));`);
    componentStatements.push(...componentChecks(entry.component, component));
    if (context.narrow) {
      componentStatements.push(tagCheck(entry, mappedExpression(entry.reference, entry.referenceOffset), entry.svg));
      for (const check of entry.checks) {
        componentStatements.push(`void (() => __meeko.checkDynamicFeature(${mappedExpression(entry.reference, entry.referenceOffset)}, ${quote(check.feature)}, ${quote(check.kind)}, ${markSource("true", check.offset, check.length)}));`);
      }
    }
  }
  statements.unshift(...componentStatements);
  for (const entry of bindings.regions) {
    if (entry.kind === "condition") {
      const condition = entry.build ? markSource(`(${entry.build((part, partOffset) => mappedExpression(part, partOffset))})`, entry.offset, entry.expression.length) : arrowExpression(entry.expression, entry.offset);
      const own = entry.build ? entry.build((part, partOffset) => plainExpression(part, partOffset)) : plainExpression(entry.expression, entry.offset);
      const inner = context.narrow ? [...guards, { code: own, names: namesOf(entry.expression) }] : guards;
      statements.push(`__meeko_cleanups.push(__meeko.bindIf(__scope, ${entry.id}, () => ${hot ? trackedRead(context, entry.offset, entry.expression, "if", condition) : condition}, () => ${rewriteLocals(entry.render, locals)}, (__scope) => { ${hydrationBody(entry.bindings, context, hot, locals, inner)} }));`);
    } else if (entry.kind === "teleport") {
      // `<MeekoTeleport>`: its content hydrates in this component wherever the document has it.
      const to = arrowExpression(entry.expression, entry.offset);
      const disabled = !entry.disabled ? "false" : entry.disabled.literal ? "true" : arrowExpression(entry.disabled.expression, entry.disabled.offset);
      statements.push(`__meeko_cleanups.push(__meeko.bindTeleport(__scope, ${entry.id}, () => ${to}, () => ${disabled}, () => ${rewriteLocals(entry.render, locals)}, (__scope) => { ${hydrationBody(entry.bindings, context, hot, locals, guards)} }));`);
    } else {
      const outerLocals = new Map(locals);
      outerLocals.delete(entry.itemName);
      outerLocals.delete(entry.indexName);
      // Each list names its signals after its id: a nested list's callback must not shadow the
      // item of the list around it, which its bindings may still read.
      const itemSignal = `__meeko_item_${entry.id}`;
      const indexSignal = `__meeko_index_${entry.id}`;
      const innerLocals = new Map(locals);
      innerLocals.set(entry.itemName, `${itemSignal}.value`);
      innerLocals.set(entry.indexName, `${indexSignal}.value`);
      const rowGuards = unshadowed(guards, [entry.itemName, entry.indexName]);
      const innerHydration = hydrationBody(entry.bindings, context, hot, innerLocals, rowGuards);
      // El callback generado sólo usa la señal de índice si aparece en su hidratación.
      const trackIndex = innerHydration.includes(`${indexSignal}.value`);
      const items = arrowExpression(entry.expression, entry.offset);
      const keyOf = entry.key === undefined ? "__meeko.indexKey" : `(${entry.itemName}, ${entry.indexName}) => ${arrowExpression(entry.key, entry.keyOffset!, outerLocals, rowGuards)}`;
      statements.push(`__meeko_cleanups.push(__meeko.bindFor(__scope, ${entry.id}, () => ${hot ? trackedRead(context, entry.offset, entry.expression, "each", items) : items}, ${keyOf}, (${entry.itemName}, ${entry.indexName}) => ${rewriteLocals(entry.render, outerLocals)}, (${itemSignal}, ${indexSignal}, __scope) => { ${innerHydration} }, ${trackIndex}));`);
    }
  }
  return `const __meeko_cleanups: Array<() => void> = [];
  try {
    ${statements.join("\n")}
    return () => __meeko.releaseAll(__meeko_cleanups);
  } catch (__meeko_error) { __meeko.releaseAll(__meeko_cleanups, { error: __meeko_error }); }`;
}

/**
 * Module-level expressions of the components a template renders, for the `__meekoChildren` mark;
 * `null` when one is chosen at run time: a setup binding, a list item or a snippet parameter. A
 * layout's `<component is="props.outlet">` is left out: the browser checks the page itself.
 */
function templateChildren(bindings: TemplateBindings, setupNames: ReadonlySet<string>, propsName: string | undefined, propAliases: ReadonlyMap<string, string> | undefined): string[] | null {
  // Mapped to the tag, so a name that does not resolve is reported there once more, not elsewhere.
  const children = new Map<string, string>();
  let dynamic = false;
  const visit = (current: TemplateBindings, locals: ReadonlySet<string>): void => {
    const child = (expression: string, offset: number): void => {
      const reference = expression.trim();
      const root = /^([A-Za-z_$][\w$]*)(?:\s*\.\s*[A-Za-z_$][\w$]*)*$/.exec(reference)?.[1];
      const outlet = reference === outletReference || (propsName !== undefined && reference.replace(/\s+/g, "") === `${propsName}.outlet`) || propAliases?.get(reference.trim()) === "outlet";
      if (outlet) return;
      if (root === undefined || setupNames.has(root) || locals.has(root)) dynamic = true;
      else if (!children.has(reference)) children.set(reference, markSource(expression, offset));
    };
    for (const entry of current.components) {
      child(entry.reference, entry.referenceOffset);
      for (const snippet of entry.snippets) visit(snippet.bindings, new Set([...locals, ...snippet.params]));
    }
    // `<component is>` that may give a component: each result that is not a tag literal.
    for (const entry of current.dynamics) {
      for (const other of isCandidates(entry.reference).others) child(other, entry.referenceOffset + Math.max(0, entry.reference.indexOf(other)));
      for (const snippet of entry.component.snippets) visit(snippet.bindings, new Set([...locals, ...snippet.params]));
    }
    for (const entry of current.regions) {
      visit(entry.bindings, entry.kind === "list" ? new Set([...locals, entry.itemName, entry.indexName]) : locals);
    }
  };
  visit(bindings, new Set());
  return dynamic ? null : [...children.values()];
}

/**
 * MEEK057: the template only sees the setup bindings declared before the first browser await;
 * the statements after it run later, in the browser.
 */
function checkTemplateNames(bindings: TemplateBindings, late: ReadonlyMap<string, number>, context: TemplateContext): void {
  const check = (expression: string, offset: number, locals: ReadonlySet<string>): void => {
    for (const identifier of freeIdentifiers(expression)) {
      const declared = late.get(identifier.name);
      if (declared === undefined || locals.has(identifier.name)) continue;
      const point = locate(context.source, declared);
      throw compileError(context.source, context.filename, "MEEK057", `La plantilla no puede usar ${identifier.name}: se declara en la línea ${point.line}, después del primer await de navegador, y sólo existe en el navegador una vez montado el componente. Declara ese nombre antes de ese await`, decodedSourceOffset(context, offset + identifier.offset));
    }
  };
  const visit = (current: TemplateBindings, locals: ReadonlySet<string>): void => {
    for (const entry of current.texts) check(entry.expression, entry.offset, locals);
    for (const entry of current.htmls) check(entry.expression, entry.offset, locals);
    for (const entry of current.attributes) check(entry.expression, entry.offset, locals);
    for (const entry of current.events) check(entry.expression, entry.offset, locals);
    for (const entry of current.spreads) {
      check(entry.expression, entry.offset, locals);
      for (const part of [entry.explicit.class, entry.explicit.style]) if (part && "expression" in part) check(part.expression, part.offset, locals);
    }
    const component = (entry: ComponentBinding): void => {
      check(entry.reference, entry.referenceOffset, locals);
      if (entry.spread) check(entry.spread.expression, entry.spread.offset, locals);
      for (const prop of entry.props) check(prop.expression, prop.offset, locals);
      for (const model of entry.models) check(model.expression, model.offset, locals);
      for (const snippet of entry.snippets) {
        if (snippet.condition) check(snippet.condition.expression, snippet.condition.offset, locals);
        visit(snippet.bindings, new Set([...locals, ...snippet.params]));
      }
    };
    for (const entry of current.components) component(entry);
    for (const entry of current.tags) {
      check(entry.reference, entry.referenceOffset, locals);
      visit(entry.bindings, locals);
    }
    for (const entry of current.dynamics) {
      component(entry.component);
      visit(entry.bindings, locals);
    }
    for (const entry of current.models) {
      check(entry.expression, entry.offset, locals);
      if (entry.radio && "expression" in entry.radio) check(entry.radio.expression, entry.radio.offset, locals);
    }
    for (const entry of current.renders) {
      check(entry.snippet, entry.snippetOffset, locals);
      if (entry.args !== undefined) check(entry.args, entry.argsOffset, locals);
    }
    for (const entry of current.regions) {
      check(entry.expression, entry.offset, locals);
      if (entry.kind === "teleport" && entry.disabled && !entry.disabled.literal) check(entry.disabled.expression, entry.disabled.offset, locals);
      if (entry.kind !== "list") visit(entry.bindings, locals);
      else {
        const inner = new Set([...locals, entry.itemName, entry.indexName]);
        if (entry.key !== undefined) check(entry.key, entry.keyOffset!, inner);
        visit(entry.bindings, inner);
      }
    }
  };
  visit(bindings, new Set());
}

/** Compila una parte tipada de .meeko para SSR e hidratación del HTML existente. */
/** The component in the errors of its SSR state: its path from `app/` (or a layer), or its file name. */
function stateLabel(filename: string): string {
  const path = filename.replaceAll("\\", "/");
  const match = /(?:^|\/)((?:app|layers)\/.*)$/.exec(path);
  return match ? match[1]! : basename(path);
}

export function compile(source: string, filename = "anonymous.meeko", options: CompileOptions = {}): CompileResult {
  const { script, template, style, server } = parseSfc(source, filename);
  const generic = scriptGeneric(source, filename, script, server);
  // Exports of a page's top-level server code arrive as `props.data` and are in scope as plain values.
  const serverScript = server ? analyzeServerScript(source, filename, server) : undefined;
  const pageData = serverScript?.body ? serverScript.exports : [];
  const componentId = createHash("sha256").update(filename).digest("hex").slice(0, 12);
  const scopeAttribute = style?.attributes.some((attribute) => attribute.name === "scoped")
    ? `data-meeko-s-${createHash("sha256").update(filename).digest("hex").slice(0, 8)}`
    : undefined;
  let css: string;
  let targets: ScopeTargets = () => false;
  try {
    if (scopeAttribute) {
      const scoped = scopeCss(style?.content ?? "", scopeAttribute);
      css = scoped.css;
      // "all", the 1.x default, scopes every element of the template.
      targets = options.scopeAttribute === "matched" ? scoped.targets : () => true;
    } else css = style?.content ?? "";
  } catch (error) {
    if (error instanceof postcss.CssSyntaxError && style && error.line !== undefined && error.column !== undefined) {
      const lines = style.content.split(/\r\n|\r|\n/);
      const prior = lines.slice(0, error.line - 1).reduce((total, line) => total + line.length + 1, 0);
      throw compileError(source, filename, "MEEK019", error.reason, style.contentStart + prior + error.column - 1);
    }
    throw error;
  }
  const parsed = parseTemplate(source, template, filename);
  const bindingsForTemplate = emptyBindings();
  const projectComponents = [...options.projectComponents ?? []];
  const knownComponents = new Set([...importedComponents(script.content), ...projectComponents.filter((name) => /^[A-Z]/.test(name))]);
  const componentNames = { names: new Set([...knownComponents, ...scriptValueNames(script.content)]), complete: options.projectComponents !== undefined };
  const context: TemplateContext = { componentNames, branchComponents: new WeakSet(), source, filename, templateOffset: template.contentStart, scopeAttribute, scopeTargets: targets, nextText: 0, nextRegion: 0, nextRef: 0, nextHtml: 0, nextElement: 0, listDepth: 0, refs: new Map(), usedRefs: new Set(), nextSnippet: 0, snippetDepth: 0, selectModel: undefined, narrow: options.typeCheck === true, guards: [], shadowedTags: shadowedBuiltinTags(script.content, projectComponents), shadowedUses: new Map(), deprecatedUses: new Map(), strayDirectives: new Map(), replacedAttributes: new Map(), theme: options.theme, knownComponents, builtinModules: new Set(), decodedRegions: [] };
  const html = renderNode(parsed, bindingsForTemplate, context);
  const hot = options.hot === true;
  const scriptParts = compileScript(script, source, filename, hot, context.refs, generic);
  // Every <MeekoLink> reads `__meeko_links`; one with a written aria-current never reads the route.
  if (html.includes("__meeko_links")) {
    // `<MeekoLink>` builds its href with the typed `href()` and reads the committed route for aria-current.
    scriptParts.imports.push('import { href as __meeko_href_overloads, useRoute as __meeko_useRoute } from "@meekojs/meeko/framework";');
    // The same rule as href() in one signature: an unknown route or missing params reports what is
    // wrong instead of "No overload matches this call".
    scriptParts.types.push([
      'type __MeekoRoutes = import("@meekojs/meeko/framework").GeneratedRoutes;',
      "type __MeekoRouteId = keyof __MeekoRoutes extends never ? string : keyof __MeekoRoutes & string;",
      "type __MeekoLinkParams<K extends string> = K extends keyof __MeekoRoutes ? __MeekoRoutes[K] : Record<string, string>;",
      // A union of routes (`bind:to="props.to"`) cannot correlate each route with its params here:
      // params, if any, must be those of one of the routes, and the caller's own type correlates them.
      "type __MeekoRouteUnion<K extends string, A extends string = K> = K extends unknown ? ([A] extends [K] ? false : true) : never;",
      // Without generated routes (RouteId = string) no id says which params it takes: they are optional.
      "type __MeekoLinkOptions<K extends string> = (keyof __MeekoRoutes extends never ? { params?: Record<string, string> | undefined }",
      "  : true extends __MeekoRouteUnion<K> ? { params?: __MeekoLinkParams<K> | undefined }",
      // `undefined`, not `never`: a forwarder's `bind:params` is an explicit `undefined`, which
      // exactOptionalPropertyTypes rejects in `params?: never`, and a static route still takes no params.
      "  : keyof __MeekoLinkParams<K> extends never ? { params?: undefined } : { params: __MeekoLinkParams<K> })",
      "  & { search?: Readonly<Record<string, string | number | boolean | null | undefined>> | undefined };",
      "const __meeko_href = __meeko_href_overloads as <K extends __MeekoRouteId>(id: K, options: __MeekoLinkOptions<K>) => string;",
    ].join("\n"));
    // Since 1.8 the links also read, once, the link resolver that the plugins published.
    scriptParts.setup.unshift("const __meeko_route = __meeko_useRoute();", "const __meeko_links = __meeko.linkResolver();");
    scriptParts.names.unshift("__meeko_route", "__meeko_links");
  }
  if (html.includes(outletReference)) {
    // `<MeekoOutlet />` reads the outlet that Meeko passes, whether or not the script declares props.
    if (scriptParts.propsTypeOffset === undefined && scriptParts.propsType === "Record<string, never>") {
      scriptParts.propsType = '{ outlet: import("@meekojs/meeko").Component<Record<string, unknown>> }';
    }
    scriptParts.setup.unshift('const __meeko_outlet_props = __props as unknown as { readonly outlet: import("@meekojs/meeko").Component<Record<string, unknown>> };');
    scriptParts.names.unshift("__meeko_outlet_props");
  }
  // Each built-in component that the template uses comes from its own module (builtinComponentModules).
  for (const tag of context.builtinModules) {
    const { specifier, alias } = builtinComponentModules[tag]!;
    scriptParts.imports.push(`import * as ${alias} from ${quote(specifier)};`);
  }
  checkClientScript(source, filename, script, pageData);
  if (pageData.length) {
    // A type-only import of the block's TypeScript copy: erased at run time, read by `meeko check` and the editor.
    scriptParts.imports.push(`import type * as __meeko_server from ${quote(`./${basename(filename)}.server.js`)};`);
    scriptParts.types.push(`type __MeekoPageData = { ${pageData.map(({ name }) => `readonly ${name}: __meeko.ServerData<Awaited<typeof __meeko_server.${name}>>`).join("; ")} };`);
    // Each export must survive the payload serializer; a failure points at the export.
    scriptParts.types.push(`type __MeekoPageDataCheck = [${pageData.map(({ name, start, end }) => {
      const value = `Awaited<typeof __meeko_server.${name}>`;
      return `__meeko.SerializableExport<${markSource(value, start, end - start)}, __meeko.JsonShape<${value}>>`;
    }).join(", ")}];`);
    scriptParts.setup.unshift(
      "const __meeko_page_data = __meeko.pageData(__props) as __MeekoPageData;",
      ...pageData.map(({ name }) => `const ${name} = __meeko_page_data.${name};`),
    );
    scriptParts.names.unshift(...pageData.map(({ name }) => name));
  }
  context.usedRefs = scriptParts.usedRefs;
  if (scriptParts.continuationNames.size) checkTemplateNames(bindingsForTemplate, scriptParts.continuationNames, context);
  const usesRefs = scriptParts.usedRefs.size > 0;
  // A component ref outside a list takes its exposed value from a copy of the tag check, so a
  // generic child's type parameters come from the props; the copy is never called.
  const tags = taggedRefs(bindingsForTemplate, context.narrow);
  const refHelpers: string[] = [];
  const refEntry = (name: string): string => {
    const ref = context.refs.get(name)!;
    // `<component is>` with a tag or a component: the type of its value, read from a copy that is never called.
    if (ref.target.kind === "dynamic" && !ref.list) refHelpers.push(`const __meeko_is_${ref.id} = () => (${ref.target.reference});\n`);
    else if (ref.target.kind === "dynamic") return `${quote(name)}: unknown`;
    const tagged = ref.list ? undefined : tags.get(ref);
    if (!tagged) return `${quote(name)}: ${refType(ref)}`;
    const { entry, guards } = tagged;
    // Like the tag check in the render paths, behind the `if:when` conditions around the tag.
    const guarded = (code: string, offset: number, length: number): string => guards.length ? markSource(narrowed(code, guards), offset, length) : code;
    const props = entry.props.map((prop) => `${markSource(quote(prop.name), prop.nameOffset, prop.nameLength)}: ${guarded(markSource(prop.expression, prop.offset), prop.offset, prop.expression.length)}`);
    refHelpers.push(`const __meeko_exposed_${ref.id} = () => __meeko.componentTag(() => ${guarded(markSource(entry.reference, entry.referenceOffset), entry.referenceOffset, entry.reference.length)})(${markSource(`{ ${props.join(", ")} }`, entry.offset, 1)}, null!, null!, null!);\n`);
    return `${quote(name)}: __meeko.TagExposed<ReturnType<typeof __meeko_exposed_${ref.id}>>`;
  };
  // Types of the refs the script reads, declared in the setup so a component ref can name a setup binding.
  const refsType = usesRefs
    ? `type __MeekoRefs = { ${[...scriptParts.usedRefs].map(refEntry).join("; ")} };\n`
    : "";
  const bindings = scriptParts.names.join(", ");
  // defineExpose: the setup also returns the value under a symbol, which no binding reads.
  const setupEntries = [
    ...(bindings ? [bindings] : []),
    ...(scriptParts.exposed ? ["[__meeko.exposedKey]: __meeko_exposed"] : []),
    // defineModel and destructured bindings: signals owned by the parent or by whatever returned
    // them, which this instance's state snapshots skip.
    ...(scriptParts.borrows ? ["[__meeko.borrowedKey]: __meeko_borrowed"] : []),
  ];
  const setupReturn = setupEntries.join(", ");
  // A generic component declares its parameters on every module-level type and function (G) and
  // passes them on (A); without `generic` both are empty and the module is the non-generic one.
  const G = generic ? `<${markSource(generic.declaration, generic.offset)}>` : "";
  const A = generic ? `<${generic.names.join(", ")}>` : "";
  const { exposedType, channelsType } = emitComponentChannels(scriptParts, generic);
  // The default values as written, which the editor shows on a parent's tag (`size?: "sm" | "md" = "md"`).
  // Only with defaults: a component without them keeps the module it had before 1.8.
  const defaultsType = scriptParts.defaultTexts ? `export type ComponentDefaults = ${componentDefaultsType(scriptParts.defaultTexts)};\n` : "";
  // Lets a client navigation skip loading data when no component of the new page awaits it.
  const children = templateChildren(bindingsForTemplate, new Set([...scriptParts.names, ...scriptParts.continuationNames.keys(), ...scriptParts.propAliases?.keys() ?? []]), scriptParts.propsName, scriptParts.propAliases);
  // `__meekoReactiveProps` tells a parent's binding that this module reads its props reactively,
  // so new props reach a mounted instance in place instead of rebuilding it. A module with a
  // top-level data await is still rebuilt: its requests were built from the props it rendered with,
  // and new props that need other data mount it again once they load.
  const dataMarks = `export const hasDataAwait: boolean = ${scriptParts.dataAwait};\nexport const __meekoChildren: (() => readonly unknown[]) | null = ${children ? `() => [${children.join(", ")}]` : "null"};\nexport const __meekoReactiveProps: boolean = ${!scriptParts.dataAwait};\n`;
  const resolvedProps = scriptParts.defaults ? `__meeko_resolveProps${A}(__inputProps)` : "__inputProps";
  // onMounted callbacks only run after hydrateScope; an HTML render discards them.
  const setupCall = (queue: string): string => `__meeko.collectMounted(${queue}, () => __setup${A}(${resolvedProps}${usesRefs ? ", __meeko_refs" : ""}))`;
  const refsDeclaration = usesRefs ? "const __meeko_refs = __meeko.createRefs();\n" : "";
  const setupCode = (queue: string): string => `const __bindings = ${setupCall(queue)};\n__meeko.restoreSignals(__bindings, __state);\nconst { ${bindings} } = __bindings;`;
  // Declaration of each binding, so DevTools and the editor bridge can place a signal's value in its source.
  const releaseCode = emitComponentRelease(source, filename, scriptParts.declarations, scriptParts.exposed, hot);
  const hotIdExport = hot ? `export const __hotId = ${quote(componentId)};\n` : "";
  const stateParam = ", __state?: __meeko.HotState";
  const scopeHotRootParam = hot ? ", __hotRoot?: Element" : "";
  const scopeForward = hot ? "__scope, __inputProps, __state, root" : "__scope, __inputProps, __state";
  const { setupPropsType, propsDeclaration } = emitComponentProps(scriptParts, generic);
  // Since 1.5 a layout with `<MeekoOutlet />` may declare its own props without `outlet`: Meeko
  // passes it anyway, so it joins the props type (its pages and the contracts see it).
  const outletProps = !generic && scriptParts.propsTypeOffset !== undefined && html.includes(outletReference)
    ? `${propsDeclaration.replace("type __MeekoComponentProps = ", "type __MeekoPropsBesideOutlet = ").replace("export type { __MeekoComponentProps as ComponentProps };", "")}\ntype __MeekoComponentProps = __MeekoPropsBesideOutlet & { outlet: import("@meekojs/meeko").Component<Record<string, unknown>> };\nexport type { __MeekoComponentProps as ComponentProps };`
    : propsDeclaration;
  // Without a processed module, `css` is the compiler's own string, as before 1.8. A host that
  // does not process CSS (Vitest without `css: true`) resolves the module as "": the compiler's
  // string stands in, so `css` is never empty for a component with a <style>.
  const styleModule = css ? options.styleModule?.(css) : undefined;
  const cssExport = styleModule === undefined
    ? `export const css = ${quote(css)};\n`
    : `import __meeko_css from ${quote(styleModule)};\nexport const css: string = __meeko_css || ${quote(css)};\n`;
  const markedCode = `// Generated by Meeko. Edit the .meeko source instead.\nimport * as __meeko from "@meekojs/meeko/internal";\n${scriptParts.imports.join("\n")}\n${scriptParts.types.join("\n")}\n${outletProps}\nfunction __setup${G}(__props: ${setupPropsType}${usesRefs ? ", __meeko_refs: __meeko.ElementRefs" : ""}) {\n${refsType}${scriptParts.setup.join("\n")}\n${refHelpers.join("")}return { ${setupReturn} };\n}\n${exposedType}${defaultsType}${channelsType}${cssExport}${dataMarks}${hotIdExport}export function renderWithState${G}(__inputProps: __MeekoComponentProps${A}): { html: string; state: __meeko.HotState } {\nreturn __meeko.createRoot((__meeko_dispose) => {\nconst __meeko_transfer = true;\n${refsDeclaration}const __bindings = ${setupCall("null")};\nconst { ${bindings} } = __bindings;\nreturn __meeko.finishWithCleanup(() => {\nconst __meeko_html = ${html};\nconst __meeko_state = __meeko.transferState(__bindings, ${quote(stateLabel(filename))});\nreturn { html: __meeko_html, state: __meeko_state };\n}, __meeko_dispose);\n});\n}\nexport function renderToString${G}(__inputProps: __MeekoComponentProps${A}${stateParam}): string {\nreturn __meeko.createRoot((__meeko_dispose) => {\nconst __meeko_transfer = false;\n${refsDeclaration}${setupCode("null")}\nreturn __meeko.finishWithCleanup(() => ${html}, __meeko_dispose);\n});\n}\nexport function hydrate${G}(root: Element, __inputProps: __MeekoComponentProps${A}${stateParam}): () => void {\nconst __scope: __meeko.DomScope = { root };\nreturn hydrateScope${A}(${scopeForward});\n}\nexport function hydrateScope${G}(__scope: __meeko.DomScope, __inputProps: __MeekoComponentProps${A}${stateParam}${scopeHotRootParam}): __meeko.ComponentRelease<ComponentExposed${A}> {\nreturn __meeko.mountBatch(() => __meeko.createRoot((__meeko_dispose) => {\nconst __meeko_transfer = false;\nconst __mounted: Array<() => __meeko.MountedResult> = [];\n${refsDeclaration}${setupCode("__mounted")}\nconst __release = (() => { ${hydrationBody(bindingsForTemplate, context, hot)} })();\n__meeko.runMounted(__mounted);\n${releaseCode}\n}));\n}\n`;
  const extracted = extractSourceMappings(markedCode);
  let { code } = extracted;
  let mappings = remapDecodedRegions(code, extracted.mappings, context.decodedRegions);
  if (scriptParts.propAliases?.size) {
    try {
      ({ code, mappings } = rewritePropAliases(code, mappings, scriptParts.propAliases, scriptParts.propsName!));
    } catch (error) {
      if (!(error instanceof PropAliasWriteError)) throw error;
      throw compileError(source, filename, "MEEK125", error.message, error.offset ?? script.contentStart);
    }
  }
  // MEEK106: the project's component keeps a built-in tag's name; renaming it adopts the built-in.
  const warnings = [...scriptParts.warnings, ...[...context.shadowedUses].map(([tag, offset]): CompileDiagnostic => ({
    code: "MEEK106", filename, location: locate(source, offset), severity: "warning",
    message: `<${tag}> es el componente ${tag} del proyecto, no la etiqueta propia de Meeko (${builtinDescriptions[tag]}); renombra el componente para usar la de Meeko`,
  })), ...[...context.deprecatedUses].map(([tag, offset]): CompileDiagnostic => ({
    // MEEK121: the tag works through 1.x; the component of `@meekojs/ui` has the same contract.
    code: "MEEK121", filename, location: locate(source, offset), severity: "warning",
    message: `<${tag}> está obsoleta desde Meeko 1.8 y se retira en 2.0: usa <${deprecatedBuiltinTags[tag]}> de @meekojs/ui, con las mismas props, snippets y marcado`,
  })), ...[...context.strayDirectives].map(([offset, { name, directive }]): CompileDiagnostic => ({
    code: "MEEK119", filename, location: locate(source, offset), severity: "warning",
    message: directive === "each:of"
      ? `${name} no es una directiva de each:of (each:as, each:key, each:index) y se escribe como atributo HTML literal; quítalo o corrige su nombre`
      : `${name} no es una directiva de if:when y se escribe como atributo HTML literal; quítalo o corrige su nombre`,
  })), ...[...context.replacedAttributes].map(([offset, name]): CompileDiagnostic => ({
    // MEEK133: since 1.8 the directive wins in any order, and SSR and hydration agree on it.
    code: "MEEK133", filename, location: locate(source, offset), severity: "warning",
    message: `${name} está escrito como texto y con bind:${name}: sólo vale bind:${name} y el texto se ignora; deja uno de los dos, con el texto como alternativa dentro de la expresión si lo necesitas`,
  })), ...layoutShiftHints(source, filename, script.content, script.contentStart, parsed)];
  return { code, css, mappings, ...(warnings.length ? { warnings } : {}) };
}
