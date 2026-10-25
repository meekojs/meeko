import { createHash } from "node:crypto";
import { basename } from "node:path";
import ts from "@typescript/typescript6";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { extractSourceMappings, markSource } from "./compiler/mapping.js";
import type { SourceMapping } from "./compiler/mapping.js";
import { instrumentNode, instrumentTemplateExpression, trackedRead } from "./compiler/devtools.js";
import { analyzePropsDefaults, PropsDefaultsError } from "./compiler/props.js";
import { compileError, locate, parseSfc } from "./compiler/sfc.js";
import type { SfcSection } from "./compiler/sfc.js";
import { scanInterpolations } from "./compiler/interpolation.js";
import { attributeValueStart, decodeTemplateText, parseTemplate } from "./compiler/template.js";
import { templateEventType } from "./compiler/events.js";
import type { TemplateNode } from "./compiler/template.js";

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
}

interface AttributeBinding {
  id: number;
  name: string;
  expression: string;
  offset: number;
}

interface ConditionBinding {
  kind: "condition";
  id: number;
  expression: string;
  offset: number;
  render: string;
  bindings: TemplateBindings;
}

interface ListBinding {
  kind: "list";
  id: number;
  expression: string;
  offset: number;
  key: string;
  keyOffset: number;
  itemName: string;
  indexName: string;
  render: string;
  bindings: TemplateBindings;
}

interface ComponentBinding {
  id: number;
  reference: string;
  referenceOffset: number;
  props: Array<{ name: string; nameOffset: number; expression: string; offset: number }>;
  offset: number;
}

interface TemplateBindings {
  texts: DynamicText[];
  events: EventBinding[];
  attributes: AttributeBinding[];
  components: ComponentBinding[];
  regions: Array<ConditionBinding | ListBinding>;
}

interface TemplateContext {
  source: string;
  filename: string;
  templateOffset: number;
  scopeAttribute: string | undefined;
  nextText: number;
  nextEvent: number;
  nextAttribute: number;
  nextRegion: number;
}

function emptyBindings(): TemplateBindings {
  return { texts: [], events: [], attributes: [], components: [], regions: [] };
}

/** Resultado del compilador de un componente .meeko. */
export interface CompileResult {
  code: string;
  css: string;
  mappings: readonly SourceMapping[];
}

/** Opciones de generación; HMR se incluye solo en módulos de desarrollo. */
export interface CompileOptions {
  hot?: boolean;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function validateExpression(expression: string, source: string, filename: string, offset: number): void {
  const prefix = "const __check = (";
  const parsed = ts.createSourceFile(filename, `${prefix}${expression});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] };
  const error = parsed.parseDiagnostics[0];
  if (error) {
    const position = Math.max(0, Math.min(expression.length, (error.start ?? prefix.length) - prefix.length));
    throw compileError(source, filename, "MEEK020", ts.flattenDiagnosticMessageText(error.messageText, "\n"), offset + position);
  }
}

function attributeValueOffset(node: TemplateNode, name: string, context: TemplateContext): number {
  const position = node.sourceCodeLocation?.attrs?.[name];
  if (!position) return context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0);
  const start = context.templateOffset + position.startOffset;
  return attributeValueStart(context.source, { start, end: context.templateOffset + position.endOffset }) ?? start;
}

function rewriteLocals(expression: string, locals: ReadonlyMap<string, string>): string {
  if (locals.size === 0) return expression;
  const prefix = "const __value = (";
  const file = ts.createSourceFile("template-expression.ts", `${prefix}${expression});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const changes: Array<{ start: number; end: number; text: string }> = [];
  function isShadowed(node: ts.Identifier): boolean {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && parent.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === node.text)) return true;
      if (ts.isSourceFile(parent)) break;
    }
    return false;
  }
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      const replacement = locals.get(node.text);
      const parent = node.parent;
      if (replacement && parent && !isShadowed(node)
        && !(ts.isPropertyAccessExpression(parent) && parent.name === node)
        && !(ts.isPropertyAssignment(parent) && parent.name === node)
        && !(ts.isParameter(parent) && parent.name === node)
        && !(ts.isVariableDeclaration(parent) && parent.name === node)) {
        const shorthand = ts.isShorthandPropertyAssignment(parent) && parent.name === node;
        changes.push({ start: node.getStart(file) - prefix.length, end: node.getEnd() - prefix.length, text: shorthand ? `${node.text}: (${replacement})` : `(${replacement})` });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  let result = expression;
  for (const change of changes.reverse()) {
    if (change.start >= 0 && change.end <= expression.length) result = result.slice(0, change.start) + change.text + result.slice(change.end);
  }
  return result;
}

/** `raw` is the source text of a text node, so every offset is a source position. */
function textParts(raw: string, bindings: TemplateBindings, context: TemplateContext, offset: number): string[] {
  const parts: string[] = [];
  const scan = scanInterpolations(raw);
  let cursor = 0;
  for (const segment of scan.segments) {
    const staticPart = decodeTemplateText(raw.slice(cursor, segment.start));
    if (staticPart) parts.push(`__meeko.escapeHtml(${quote(staticPart)})`);
    const expression = decodeTemplateText(segment.expression);
    if (!expression) throw compileError(context.source, context.filename, "MEEK009", "Empty template expression", offset + segment.start);
    const expressionOffset = offset + segment.expressionStart;
    validateExpression(expression, context.source, context.filename, expressionOffset);
    const id = context.nextText++;
    bindings.texts.push({ id, expression, offset: expressionOffset });
    parts.push(`${quote(`<!--meeko:text:${id}-->`)} + __meeko.escapeHtml(${markSource(expression, expressionOffset)}) + ${quote(`<!--/meeko:text:${id}-->`)}`);
    cursor = segment.end;
  }
  if (scan.unterminated !== undefined) throw compileError(context.source, context.filename, "MEEK010", "Unclosed template expression", offset + scan.unterminated);
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
  if (condition && list) throw compileError(context.source, context.filename, "MEEK021", "A node cannot have both if:when and each:of", position);
  if (condition || list) {
    const inner = emptyBindings();
    const excluded = new Set(condition ? ["if:when"] : ["each:of", "each:as", "each:key", "each:index"]);
    const clone: TemplateNode = { ...node, attrs: attrsList.filter((attribute) => !excluded.has(attribute.name)) };
    const html = renderNodeContent(clone, inner, context);
    const id = context.nextRegion++;
    if (condition) {
      const offset = attributeValueOffset(node, "if:when", context);
      validateExpression(condition.value, context.source, context.filename, offset);
      bindings.regions.push({ kind: "condition", id, expression: condition.value, offset, render: html, bindings: inner });
      return `__meeko.renderIf(${id}, ${markSource(condition.value, offset)}, () => ${html})`;
    }
    const itemName = attrsList.find((attribute) => attribute.name === "each:as")?.value;
    const key = attrsList.find((attribute) => attribute.name === "each:key")?.value;
    const indexName = attrsList.find((attribute) => attribute.name === "each:index")?.value ?? "index";
    if (!itemName || !/^[a-zA-Z_$][\w$]*$/.test(itemName) || itemName.startsWith("__") || !/^[a-zA-Z_$][\w$]*$/.test(indexName) || indexName.startsWith("__") || itemName === indexName) {
      throw compileError(context.source, context.filename, "MEEK022", "A list needs valid, distinct each:as and each:index identifiers", position);
    }
    if (!key) throw compileError(context.source, context.filename, "MEEK023", "A list requires each:key", position);
    const offset = attributeValueOffset(node, "each:of", context);
    const keyOffset = attributeValueOffset(node, "each:key", context);
    validateExpression(list!.value, context.source, context.filename, offset);
    validateExpression(key, context.source, context.filename, keyOffset);
    bindings.regions.push({ kind: "list", id, expression: list!.value, offset, key, keyOffset, itemName, indexName, render: html, bindings: inner });
    return `__meeko.renderFor(${id}, ${markSource(list!.value, offset)}, (${itemName}, ${indexName}) => ${markSource(`(${markSource(key, keyOffset)})`, keyOffset, key.length)}, (${itemName}, ${indexName}) => ${html})`;
  }
  if (attrsList.some((attribute) => attribute.name.startsWith("each:") || attribute.name.startsWith("if:"))) {
    throw compileError(context.source, context.filename, "MEEK024", "Incomplete template directive", position);
  }
  return renderNodeContent(node, bindings, context);
}

function renderNodeContent(node: TemplateNode, bindings: TemplateBindings, context: TemplateContext): string {
  if (node.tagName === "template") {
    return (node.content?.childNodes ?? []).map((child) => renderNode(child, bindings, context)).join(" + ") || quote("");
  }
  if (node.tagName === "component") {
    const position = node.start;
    const referenceAttribute = node.attrs?.find((attribute) => attribute.name === "is");
    const reference = referenceAttribute?.value ?? "";
    if (!reference.trim()) throw compileError(context.source, context.filename, "MEEK030", "A component requires is=\"expression\"", position);
    const referenceOffset = attributeValueOffset(node, "is", context);
    validateExpression(reference, context.source, context.filename, referenceOffset);
    if ((node.childNodes ?? []).some((child) => child.nodeName !== "#text" || Boolean(child.value?.trim()))) {
      throw compileError(context.source, context.filename, "MEEK031", "Component children are not supported; close the tag without content", position);
    }
    const props: ComponentBinding["props"] = [];
    for (const attribute of node.attrs ?? []) {
      if (attribute.name === "is") continue;
      const rawName = /^[^\s=]+/.exec(context.source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name;
      if (!rawName.startsWith("bind:") || !/^[a-zA-Z_$][\w$]*$/.test(rawName.slice(5))) {
        throw compileError(context.source, context.filename, "MEEK032", "Component props must use bind:prop=\"expression\"", attribute.start);
      }
      const name = rawName.slice(5);
      const offset = attributeValueOffset(node, attribute.name, context);
      validateExpression(attribute.value, context.source, context.filename, offset);
      props.push({ name, nameOffset: attribute.start + 5, expression: attribute.value, offset });
    }
    const id = context.nextRegion++;
    bindings.components.push({ id, reference, referenceOffset, props, offset: position });
    const mappedProps = props.map((prop) => `${markSource(quote(prop.name), prop.nameOffset, prop.name.length)}: ${markSource(prop.expression, prop.offset)}`);
    const object = markSource(`{ ${mappedProps.join(", ")} }`, position, node.end - position);
    return `__meeko.renderComponent(${id}, ${markSource(reference, referenceOffset)}, ${object}, __meeko_transfer)`;
  }
  const tag = node.tagName!;

  const attrs: Array<{ kind: "static"; value: string } | { kind: "dynamic"; expression: string }> = [];
  for (const attr of node.attrs ?? []) {
    if (attr.name.startsWith("on:")) {
      const name = attr.name.slice(3);
      if (!/^[a-z]+$/.test(name)) throw compileError(context.source, context.filename, "MEEK011", `Invalid event name: ${name}`, context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
      const id = context.nextEvent++;
      const offset = attributeValueOffset(node, attr.name, context);
      validateExpression(attr.value, context.source, context.filename, offset);
      bindings.events.push({ id, name, expression: attr.value, offset });
      attrs.push({ kind: "static", value: ` data-meeko-e-${id}=""` });
    } else if (attr.name.startsWith("bind:")) {
      const name = attr.name.slice(5);
      if (!/^[a-z][a-z0-9:.-]*$/.test(name) || name.startsWith("on")) {
        throw compileError(context.source, context.filename, "MEEK012", `Invalid dynamic attribute: ${name}`, context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
      }
      const offset = attributeValueOffset(node, attr.name, context);
      validateExpression(attr.value, context.source, context.filename, offset);
      const id = context.nextAttribute++;
      bindings.attributes.push({ id, name, expression: attr.value, offset });
      attrs.push({ kind: "static", value: ` data-meeko-a-${id}=""` });
      attrs.push({ kind: "dynamic", expression: `__meeko.renderAttribute(${quote(name)}, ${markSource(attr.value, offset)})` });
    } else if (attr.name.startsWith(":")) {
      throw compileError(context.source, context.filename, "MEEK012", `Unsupported template directive: ${attr.name}`, context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
    } else {
      attrs.push({ kind: "static", value: ` ${attr.name}="${escapeAttribute(attr.value)}"` });
    }
  }
  if (context.scopeAttribute) attrs.push({ kind: "static", value: ` ${context.scopeAttribute}=""` });
  const openingParts: string[] = [quote(`<${tag}`)];
  for (const attr of attrs) {
    if (attr.kind === "dynamic") openingParts.push(attr.expression);
    else openingParts.push(quote(attr.value));
  }
  openingParts.push(quote(">"));
  const opening = openingParts.join(" + ");
  const voidElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  if (voidElements.has(tag)) return opening;
  const children = (node.childNodes ?? []).map((child) => renderNode(child, bindings, context));
  return [opening, ...children, quote(`</${tag}>`)].join(" + ");
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function scopeCss(css: string, scopeAttribute: string): string {
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    let parent: postcss.Node | undefined = rule.parent;
    while (parent) {
      if (parent.type === "atrule" && /keyframes$/i.test((parent as postcss.AtRule).name)) return;
      parent = parent.parent;
    }
    const fail = (message: string, node: selectorParser.Node): never => {
      throw rule.error(message, { index: node.sourceIndex });
    };
    rule.selector = selectorParser((selectors) => {
      selectors.each((selector) => scopeSelector(selector, scopeAttribute, fail));
    }).processSync(rule.selector);
  });
  return root.toString();
}

function isGlobalPseudo(node: selectorParser.Node): node is selectorParser.Pseudo {
  return node.type === "pseudo" && node.value.toLowerCase() === ":global";
}

/**
 * Añade el atributo de ámbito al último compuesto local del selector y desenvuelve `:global(...)`.
 * Un compuesto que contiene `:global(...)` no se limita; si todo el selector es global, no recibe atributo.
 */
function scopeSelector(selector: selectorParser.Selector, scopeAttribute: string, fail: (message: string, node: selectorParser.Node) => never): void {
  const globals: selectorParser.Pseudo[] = [];
  selector.walkPseudos((pseudo) => {
    if (!isGlobalPseudo(pseudo)) return;
    if (pseudo.parent !== selector) fail(":global(<selector>) must be used at the top level of a selector, not inside another pseudo-class", pseudo);
    if (pseudo.nodes.length > 1) fail(":global(...) accepts a single selector; write one :global(<selector>) per selector in the list", pseudo);
    if (!pseudo.nodes[0]?.nodes.some((node) => node.type !== "comment")) fail(":global requires a selector argument; use :global(<selector>)", pseudo);
    globals.push(pseudo);
  });
  const compounds: Array<Array<selectorParser.Selector["nodes"][number]>> = [[]];
  for (const node of selector.nodes) {
    if (node.type === "combinator") compounds.push([]);
    else if (node.type !== "comment") compounds.at(-1)!.push(node);
  }
  const scoped = compounds.filter((compound) => compound.length > 0 && !compound.some(isGlobalPseudo)).at(-1);
  if (scoped) {
    const attribute = selectorParser.attribute({ attribute: scopeAttribute, value: undefined, raws: {} });
    const pseudoElement = scoped.find((node) => node.type === "pseudo" && node.value.startsWith("::"));
    if (pseudoElement) selector.insertBefore(pseudoElement, attribute);
    else selector.insertAfter(scoped.at(-1)!, attribute);
  }
  for (const pseudo of globals) {
    const inner = pseudo.nodes[0]!.nodes.slice();
    inner[0]!.rawSpaceBefore = pseudo.rawSpaceBefore;
    inner.at(-1)!.rawSpaceAfter = pseudo.rawSpaceAfter;
    pseudo.replaceWith(...inner);
  }
}

function compileScript(section: SfcSection, source: string, filename: string, hot: boolean): { imports: string[]; types: string[]; setup: string[]; names: string[]; propsType: string; propsTypeOffset: number | undefined; defaults?: { expression: string; offset: number; keys: readonly string[] } } {
  const file = ts.createSourceFile(filename, section.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] };
  const syntaxError = file.parseDiagnostics[0];
  if (syntaxError) {
    const message = ts.flattenDiagnosticMessageText(syntaxError.messageText, "\n");
    throw compileError(source, filename, "MEEK013", message, section.contentStart + (syntaxError.start ?? 0));
  }
  const imports: string[] = [];
  const types: string[] = [];
  const setup: string[] = [];
  const names: string[] = [];
  let propsType: string | undefined;
  let propsTypeOffset: number | undefined;
  let defaults: { expression: string; offset: number; keys: readonly string[] } | undefined;
  // En desarrollo con `hot`, DevTools registra escrituras `.value` y lecturas de `computed`; producción y SSR sin `hot` no cambian.
  const setupStatement = (statement: ts.Statement): string => {
    const original = statement.getText(file);
    const instrumented = hot ? instrumentNode(file, statement, (position) => section.contentStart + position, { source, filename }, { computed: true }) : undefined;
    return markSource(instrumented ?? original, section.contentStart + statement.getStart(file), original.length);
  };
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      imports.push(markSource(statement.getText(file), section.contentStart + statement.getStart(file)));
      continue;
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      types.push(markSource(statement.getText(file), section.contentStart + statement.getStart(file)));
      continue;
    }
    if (ts.isExportDeclaration(statement) && (statement.isTypeOnly ||
      (statement.exportClause && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.every((element) => element.isTypeOnly)))) {
      types.push(markSource(statement.getText(file), section.contentStart + statement.getStart(file)));
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      if (statement.declarationList.declarations.length !== 1) throw compileError(source, filename, "MEEK014", "Declare one variable per statement in .meeko scripts", section.contentStart + statement.getStart(file));
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) throw compileError(source, filename, "MEEK015", "Only simple variable declarations are supported in .meeko scripts", section.contentStart + declaration.getStart(file));
        const name = declaration.name.text;
        names.push(name);
        if (declaration.initializer && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(file) === "defineProps") {
          if (propsType) throw compileError(source, filename, "MEEK016", "defineProps must appear once in its own declaration", section.contentStart + declaration.getStart(file));
          const typeArgument = declaration.initializer.typeArguments?.[0];
          propsType = typeArgument?.getText(file);
          if (!propsType) throw compileError(source, filename, "MEEK017", "defineProps requires a type argument", section.contentStart + declaration.getStart(file));
          propsTypeOffset = section.contentStart + typeArgument!.getStart(file);
          try {
            const analyzed = analyzePropsDefaults(declaration.initializer);
            if (analyzed) defaults = {
              expression: analyzed.argument.getText(file),
              offset: section.contentStart + analyzed.argument.getStart(file),
              keys: analyzed.keys,
            };
          } catch (error) {
            if (!(error instanceof PropsDefaultsError)) throw error;
            throw compileError(source, filename, error.code, error.message, section.contentStart + error.node.getStart(file));
          }
          setup.push(`const ${name}: ${defaults ? "__MeekoResolvedProps" : markSource(propsType, propsTypeOffset)} = __props;`);
        } else {
          setup.push(setupStatement(statement));
        }
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.push(statement.name.text);
      setup.push(setupStatement(statement));
      continue;
    }
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
      setup.push(setupStatement(statement));
      continue;
    }
    throw compileError(source, filename, "MEEK018", `Unsupported top-level script statement: ${ts.SyntaxKind[statement.kind]}`, section.contentStart + statement.getStart(file));
  }
  return { imports, types, setup, names, propsType: propsType ?? "Record<string, never>", propsTypeOffset, ...(defaults ? { defaults } : {}) };
}

function hydrationBody(bindings: TemplateBindings, context: TemplateContext, hot: boolean, locals: ReadonlyMap<string, string> = new Map()): string {
  const statements: string[] = [];
  const mappedExpression = (expression: string, offset: number, expressionLocals = locals): string =>
    markSource(rewriteLocals(expression, expressionLocals), offset, expression.length);
  // Los paréntesis evitan que `() => { ... }.value` se lea como bloque; su tramo externo conserva la ubicación.
  const arrowExpression = (expression: string, offset: number, expressionLocals = locals): string =>
    markSource(`(${mappedExpression(expression, offset, expressionLocals)})`, offset, expression.length);
  for (const { id, expression, offset } of bindings.texts) {
    const point = locate(context.source, offset);
    const location = `${basename(context.filename)}:${point.line}:${point.column} (text ${id})`;
    const source = hot ? `, { file: ${quote(context.filename)}, line: ${point.line}, column: ${point.column}, expression: ${quote(expression)}, kind: "text" }` : "";
    statements.push(`cleanups.push(__meeko.bindText(__scope, ${id}, () => ${arrowExpression(expression, offset)}, ${quote(location)}${source}));`);
  }
  for (const { id, name, expression, offset } of bindings.attributes) {
    const point = locate(context.source, offset);
    const location = `${basename(context.filename)}:${point.line}:${point.column} (attribute ${name})`;
    const source = hot ? `, { file: ${quote(context.filename)}, line: ${point.line}, column: ${point.column}, expression: ${quote(expression)}, kind: "attribute" }` : "";
    statements.push(`cleanups.push(__meeko.bindAttribute(__scope, ${id}, ${quote(name)}, () => ${arrowExpression(expression, offset)}, ${quote(location)}${source}));`);
  }
  for (const { id, name, expression, offset } of bindings.events) {
    const eventType = templateEventType(name);
    const handlerExpression = hot ? markSource(rewriteLocals(instrumentTemplateExpression(expression, offset, context), locals), offset, expression.length) : mappedExpression(expression, offset);
    const handler = markSource(`((__meeko_handler: (event: ${eventType}) => unknown) => __meeko_handler(event as ${eventType}))(${handlerExpression});`, offset, expression.length);
    statements.push(`{
      cleanups.push(__meeko.bindEvent(__scope, ${id}, ${quote(name)}, (event: Event) => {
        return ${handler}
      }));
    }`);
  }
  const componentStatements: string[] = [];
  for (const entry of bindings.components) {
    const point = locate(context.source, entry.offset);
    const location = `${basename(context.filename)}:${point.line}:${point.column} (component ${entry.reference})`;
    const props = entry.props.map((prop) => {
      const value = mappedExpression(prop.expression, prop.offset);
      return `${markSource(quote(prop.name), prop.nameOffset, prop.name.length)}: ${hot ? trackedRead(context, prop.offset, prop.expression, "prop", `(${value})`, prop.name) : value}`;
    });
    const object = markSource(`{ ${props.join(", ")} }`, entry.offset, 1);
    componentStatements.push(`cleanups.push(__meeko.bindComponent(__scope, ${entry.id}, () => ${arrowExpression(entry.reference, entry.referenceOffset)}, () => (${object}), ${quote(location)}));`);
  }
  statements.unshift(...componentStatements);
  for (const entry of bindings.regions) {
    if (entry.kind === "condition") {
      const condition = arrowExpression(entry.expression, entry.offset);
      statements.push(`cleanups.push(__meeko.bindIf(__scope, ${entry.id}, () => ${hot ? trackedRead(context, entry.offset, entry.expression, "if", condition) : condition}, () => ${rewriteLocals(entry.render, locals)}, (__scope) => { ${hydrationBody(entry.bindings, context, hot, locals)} }));`);
    } else {
      const outerLocals = new Map(locals);
      outerLocals.delete(entry.itemName);
      outerLocals.delete(entry.indexName);
      const innerLocals = new Map(locals);
      innerLocals.set(entry.itemName, "__meeko_item.value");
      innerLocals.set(entry.indexName, "__meeko_index.value");
      const innerHydration = hydrationBody(entry.bindings, context, hot, innerLocals);
      // El callback generado sólo usa la señal de índice si aparece en su hidratación.
      const trackIndex = innerHydration.includes("__meeko_index.value");
      const items = arrowExpression(entry.expression, entry.offset);
      statements.push(`cleanups.push(__meeko.bindFor(__scope, ${entry.id}, () => ${hot ? trackedRead(context, entry.offset, entry.expression, "each", items) : items}, (${entry.itemName}, ${entry.indexName}) => ${arrowExpression(entry.key, entry.keyOffset, outerLocals)}, (${entry.itemName}, ${entry.indexName}) => ${rewriteLocals(entry.render, outerLocals)}, (__meeko_item, __meeko_index, __scope) => { ${innerHydration} }, ${trackIndex}));`);
    }
  }
  return `const cleanups: Array<() => void> = [];
  try {
    ${statements.join("\n")}
    return () => __meeko.releaseAll(cleanups);
  } catch (error) { __meeko.releaseAll(cleanups, { error }); }`;
}

/** Compila una parte tipada de .meeko para SSR e hidratación del HTML existente. */
export function compile(source: string, filename = "anonymous.meeko", options: CompileOptions = {}): CompileResult {
  const { script, template, style } = parseSfc(source, filename);
  const componentId = createHash("sha256").update(filename).digest("hex").slice(0, 12);
  const scopeAttribute = style?.attributes.some((attribute) => attribute.name === "scoped")
    ? `data-meeko-s-${createHash("sha256").update(filename).digest("hex").slice(0, 8)}`
    : undefined;
  let css: string;
  try {
    css = scopeAttribute ? scopeCss(style?.content ?? "", scopeAttribute) : style?.content ?? "";
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
  const context: TemplateContext = { source, filename, templateOffset: template.contentStart, scopeAttribute, nextText: 0, nextEvent: 0, nextAttribute: 0, nextRegion: 0 };
  const html = renderNode(parsed, bindingsForTemplate, context);
  const hot = options.hot === true;
  const scriptParts = compileScript(script, source, filename, hot);
  const bindings = scriptParts.names.join(", ");
  const resolvedProps = scriptParts.defaults ? "__meeko_resolveProps(__inputProps)" : "__inputProps";
  const setupCode = `const __bindings = __setup(${resolvedProps});\n__meeko.restoreSignals(__bindings, __state);\nconst { ${bindings} } = __bindings;`;
  const releaseCode = hot
    ? `const __cleanup = () => __meeko.finishWithCleanup(__release, dispose);\nconst __component = { renderToString, hydrate, hydrateScope, css };\nconst __snapshot = () => __meeko.snapshotSignals(__bindings);\nconst __devtoolsStop = __meeko.registerDevtoolsInstance({ componentId: __hotId, name: ${quote(basename(filename, ".meeko"))}, file: ${quote(filename)}, scope: __scope, props: __inputProps, bindings: __bindings });\nconst __dispose = () => __meeko.finishWithCleanup(__cleanup, __devtoolsStop);\nconst __stop = __hotRoot ? __meeko.registerHotInstance(__hotId, __hotRoot, __inputProps, __component, __snapshot, __dispose) : __scope.start ? __meeko.registerHotScope(__hotId, __scope, __inputProps, __component, __snapshot, __dispose) : __dispose;\nreturn __meeko.withStateSnapshot(__stop, __snapshot);`
    : `return __meeko.withStateSnapshot(() => __meeko.finishWithCleanup(__release, dispose), () => __meeko.snapshotSignals(__bindings));`;
  const hotIdExport = hot ? `export const __hotId = ${quote(componentId)};\n` : "";
  const stateParam = ", __state?: __meeko.HotState";
  const scopeHotRootParam = hot ? ", __hotRoot?: Element" : "";
  const scopeForward = hot ? "__scope, __inputProps, __state, root" : "__scope, __inputProps, __state";
  const propsType = scriptParts.propsTypeOffset === undefined ? scriptParts.propsType : markSource(scriptParts.propsType, scriptParts.propsTypeOffset);
  const defaults = scriptParts.defaults;
  const defaultKeys = defaults?.keys.map(quote).join(" | ") || "never";
  const propsDeclaration = defaults ? `type __MeekoDeclaredProps = ${propsType};
type __MeekoDefaultKeys = Extract<${defaultKeys}, keyof __MeekoDeclaredProps>;
type __MeekoDefaultPick = Pick<__MeekoDeclaredProps, __MeekoDefaultKeys>;
type __MeekoDefaultValues = { [K in keyof __MeekoDefaultPick]-?: Exclude<__MeekoDefaultPick[K], undefined> };
type __MeekoResolvedPropsOf<T> = T extends unknown ? Omit<T, __MeekoDefaultKeys> & __MeekoDefaultValues : never;
type __MeekoResolvedProps = __MeekoResolvedPropsOf<__MeekoDeclaredProps>;
type __MeekoInputPropsOf<T> = T extends unknown ? Omit<T, __MeekoDefaultKeys> & { [K in keyof __MeekoDefaultPick]?: __MeekoDefaultPick[K] | undefined } : never;
export type ComponentProps = __MeekoInputPropsOf<__MeekoDeclaredProps>;
function __meeko_defaultProps() {
  return (${markSource(defaults.expression, defaults.offset)} satisfies Partial<__MeekoDeclaredProps> & __MeekoDefaultValues & Record<Exclude<${defaultKeys}, keyof __MeekoDeclaredProps>, never>);
}
function __meeko_resolveProps(input: ComponentProps): __MeekoResolvedProps {
  const defaults = __meeko_defaultProps();
  const resolved = { ...defaults, ...input } as __MeekoResolvedProps;
  const mutable = resolved as unknown as Record<string, unknown>;
  for (const key of Object.keys(defaults)) {
    if (mutable[key] === undefined) mutable[key] = defaults[key as keyof typeof defaults];
  }
  return resolved;
}` : `export type ComponentProps = ${propsType};`;
  const markedCode = `// Generated by Meeko. Edit the .meeko source instead.\nimport * as __meeko from "@meekojs/meeko/internal";\n${scriptParts.imports.join("\n")}\n${scriptParts.types.join("\n")}\n${propsDeclaration}\nfunction __setup(__props: ${defaults ? "__MeekoResolvedProps" : propsType}) {\n${scriptParts.setup.join("\n")}\nreturn { ${bindings} };\n}\nexport const css = ${quote(css)};\n${hotIdExport}export function renderWithState(__inputProps: ComponentProps): { html: string; state: __meeko.HotState } {\nreturn __meeko.createRoot((dispose) => {\nconst __meeko_transfer = true;\nconst __bindings = __setup(${resolvedProps});\nconst { ${bindings} } = __bindings;\nreturn __meeko.finishWithCleanup(() => {\nconst html = ${html};\nconst state = __meeko.snapshotSignals(__bindings);\n__meeko.serializeJson(state);\nreturn { html, state };\n}, dispose);\n});\n}\nexport function renderToString(__inputProps: ComponentProps${stateParam}): string {\nreturn __meeko.createRoot((dispose) => {\nconst __meeko_transfer = false;\n${setupCode}\nreturn __meeko.finishWithCleanup(() => ${html}, dispose);\n});\n}\nexport function hydrate(root: Element, __inputProps: ComponentProps${stateParam}): () => void {\nconst __scope: __meeko.DomScope = { root };\nreturn hydrateScope(${scopeForward});\n}\nexport function hydrateScope(__scope: __meeko.DomScope, __inputProps: ComponentProps${stateParam}${scopeHotRootParam}): () => void {\nreturn __meeko.createRoot((dispose) => {\nconst __meeko_transfer = false;\n${setupCode}\nconst __release = (() => { ${hydrationBody(bindingsForTemplate, context, hot)} })();\n${releaseCode}\n});\n}\n`;
  const { code, mappings } = extractSourceMappings(markedCode);
  return { code, css, mappings };
}
