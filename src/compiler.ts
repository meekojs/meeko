import { createHash } from "node:crypto";
import { basename } from "node:path";
import ts from "@typescript/typescript6";
import { parseFragment } from "parse5";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { compileError, locate, parseSfc } from "./compiler/sfc.js";
import type { SfcSection } from "./compiler/sfc.js";

interface TemplateAttribute {
  name: string;
  value: string;
}

interface TemplateNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: TemplateAttribute[];
  childNodes?: TemplateNode[];
  content?: { childNodes: TemplateNode[] };
  sourceCodeLocation?: { startOffset: number };
}

interface DynamicText {
  id: number;
  expression: string;
  offset: number;
}

interface EventBinding {
  id: number;
  name: string;
  expression: string;
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
  render: string;
  bindings: TemplateBindings;
}

interface ListBinding {
  kind: "list";
  id: number;
  expression: string;
  key: string;
  itemName: string;
  indexName: string;
  render: string;
  bindings: TemplateBindings;
}

interface TemplateBindings {
  texts: DynamicText[];
  events: EventBinding[];
  attributes: AttributeBinding[];
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
  return { texts: [], events: [], attributes: [], regions: [] };
}

/** Resultado del compilador de un componente .meeko. */
export interface CompileResult {
  code: string;
  css: string;
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

function textParts(value: string, bindings: TemplateBindings, context: TemplateContext, offset: number): string[] {
  const parts: string[] = [];
  const pattern = /\{([^{}]+)\}/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index;
    const staticPart = value.slice(cursor, index);
    if (staticPart) parts.push(`__meeko.escapeHtml(${quote(staticPart)})`);
    const rawExpression = match[1] ?? "";
    const expression = rawExpression.trim();
    if (!expression) throw compileError(context.source, context.filename, "MEEK009", "Empty template expression", offset + index);
    validateExpression(expression, context.source, context.filename, offset + index + 1 + rawExpression.indexOf(expression));
    const id = context.nextText++;
    bindings.texts.push({ id, expression, offset: offset + index });
    parts.push(`${quote(`<!--meeko:text:${id}-->`)} + __meeko.escapeHtml(${expression}) + ${quote(`<!--/meeko:text:${id}-->`)}`);
    cursor = index + match[0].length;
  }
  const tail = value.slice(cursor);
  if (tail.includes("{")) throw compileError(context.source, context.filename, "MEEK010", "Unclosed template expression", offset + cursor + tail.indexOf("{"));
  if (tail) parts.push(`__meeko.escapeHtml(${quote(tail)})`);
  return parts;
}

function renderNode(node: TemplateNode, bindings: TemplateBindings, context: TemplateContext): string {
  if (node.nodeName === "#text") {
    return textParts(node.value ?? "", bindings, context, context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0)).join(" + ") || quote("");
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
      validateExpression(condition.value, context.source, context.filename, position);
      bindings.regions.push({ kind: "condition", id, expression: condition.value, render: html, bindings: inner });
      return `__meeko.renderIf(${id}, ${condition.value}, () => ${html})`;
    }
    const itemName = attrsList.find((attribute) => attribute.name === "each:as")?.value;
    const key = attrsList.find((attribute) => attribute.name === "each:key")?.value;
    const indexName = attrsList.find((attribute) => attribute.name === "each:index")?.value ?? "index";
    if (!itemName || !/^[a-zA-Z_$][\w$]*$/.test(itemName) || itemName.startsWith("__") || !/^[a-zA-Z_$][\w$]*$/.test(indexName) || indexName.startsWith("__") || itemName === indexName) {
      throw compileError(context.source, context.filename, "MEEK022", "A list needs valid, distinct each:as and each:index identifiers", position);
    }
    if (!key) throw compileError(context.source, context.filename, "MEEK023", "A list requires each:key", position);
    validateExpression(list!.value, context.source, context.filename, position);
    validateExpression(key, context.source, context.filename, position);
    bindings.regions.push({ kind: "list", id, expression: list!.value, key, itemName, indexName, render: html, bindings: inner });
    return `__meeko.renderFor(${id}, ${list!.value}, (${itemName}, ${indexName}) => ${key}, (${itemName}, ${indexName}) => ${html})`;
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
  const tag = node.tagName!;

  const attrs: Array<{ kind: "static"; value: string } | { kind: "dynamic"; expression: string }> = [];
  for (const attr of node.attrs ?? []) {
    if (attr.name.startsWith("on:")) {
      const name = attr.name.slice(3);
      if (!/^[a-z]+$/.test(name)) throw compileError(context.source, context.filename, "MEEK011", `Invalid event name: ${name}`, context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
      const id = context.nextEvent++;
      validateExpression(attr.value, context.source, context.filename, context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
      bindings.events.push({ id, name, expression: attr.value });
      attrs.push({ kind: "static", value: ` data-meeko-e-${id}=""` });
    } else if (attr.name.startsWith("bind:")) {
      const name = attr.name.slice(5);
      if (!/^[a-z][a-z0-9:.-]*$/.test(name) || name.startsWith("on")) {
        throw compileError(context.source, context.filename, "MEEK012", `Invalid dynamic attribute: ${name}`, context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
      }
      validateExpression(attr.value, context.source, context.filename, context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
      const id = context.nextAttribute++;
      bindings.attributes.push({ id, name, expression: attr.value, offset: context.templateOffset + (node.sourceCodeLocation?.startOffset ?? 0) });
      attrs.push({ kind: "static", value: ` data-meeko-a-${id}=""` });
      attrs.push({ kind: "dynamic", expression: `__meeko.renderAttribute(${quote(name)}, ${attr.value})` });
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
    if (rule.selector.includes(":global")) throw new Error(":global is not supported in scoped styles yet");
    rule.selector = selectorParser((selectors) => {
      selectors.each((selector) => {
        const pseudoElement = selector.nodes.find((node) => node.type === "pseudo" && node.value.startsWith("::"));
        const attribute = selectorParser.attribute({ attribute: scopeAttribute, value: undefined, raws: {} });
        if (pseudoElement) selector.insertBefore(pseudoElement, attribute);
        else selector.append(attribute);
      });
    }).processSync(rule.selector);
  });
  return root.toString();
}

function compileScript(section: SfcSection, source: string, filename: string): { imports: string[]; types: string[]; setup: string[]; names: string[]; propsType: string } {
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
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      imports.push(statement.getText(file));
      continue;
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      types.push(statement.getText(file));
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
          propsType = declaration.initializer.typeArguments?.[0]?.getText(file);
          if (!propsType) throw compileError(source, filename, "MEEK017", "defineProps requires a type argument", section.contentStart + declaration.getStart(file));
          setup.push(`const ${name}: ${propsType} = __props;`);
        } else {
          setup.push(statement.getText(file));
        }
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.push(statement.name.text);
      setup.push(statement.getText(file));
      continue;
    }
    throw compileError(source, filename, "MEEK018", `Unsupported top-level script statement: ${ts.SyntaxKind[statement.kind]}`, section.contentStart + statement.getStart(file));
  }
  return { imports, types, setup, names, propsType: propsType ?? "Record<string, never>" };
}

function hydrationBody(bindings: TemplateBindings, context: TemplateContext, locals: ReadonlyMap<string, string> = new Map()): string {
  const statements: string[] = [];
  for (const { id, expression, offset } of bindings.texts) {
    const point = locate(context.source, offset);
    const location = `${basename(context.filename)}:${point.line}:${point.column} (text ${id})`;
    statements.push(`cleanups.push(__meeko.bindText(__scope, ${id}, () => ${rewriteLocals(expression, locals)}, ${quote(location)}));`);
  }
  for (const { id, name, expression, offset } of bindings.attributes) {
    const point = locate(context.source, offset);
    const location = `${basename(context.filename)}:${point.line}:${point.column} (attribute ${name})`;
    statements.push(`cleanups.push(__meeko.bindAttribute(__scope, ${id}, ${quote(name)}, () => ${rewriteLocals(expression, locals)}, ${quote(location)}));`);
  }
  for (const { id, name, expression } of bindings.events) {
    const eventType = ["click", "input", "change", "submit", "keydown", "keyup", "focus", "blur"].includes(name)
      ? `GlobalEventHandlersEventMap[${quote(name)}]` : "Event";
    statements.push(`{
      cleanups.push(__meeko.bindEvent(__scope, ${id}, ${quote(name)}, (event: Event) => {
        const handler: (event: ${eventType}) => void = (${rewriteLocals(expression, locals)});
        handler(event as ${eventType});
      }));
    }`);
  }
  for (const entry of bindings.regions) {
    if (entry.kind === "condition") {
      statements.push(`cleanups.push(__meeko.bindIf(__scope, ${entry.id}, () => ${rewriteLocals(entry.expression, locals)}, () => ${rewriteLocals(entry.render, locals)}, (__scope) => { ${hydrationBody(entry.bindings, context, locals)} }));`);
    } else {
      const outerLocals = new Map(locals);
      outerLocals.delete(entry.itemName);
      outerLocals.delete(entry.indexName);
      const innerLocals = new Map(locals);
      innerLocals.set(entry.itemName, "__meeko_item.value");
      innerLocals.set(entry.indexName, "__meeko_index.value");
      statements.push(`cleanups.push(__meeko.bindFor(__scope, ${entry.id}, () => ${rewriteLocals(entry.expression, locals)}, (${entry.itemName}, ${entry.indexName}) => ${rewriteLocals(entry.key, outerLocals)}, (${entry.itemName}, ${entry.indexName}) => ${rewriteLocals(entry.render, outerLocals)}, (__meeko_item, __meeko_index, __scope) => { ${hydrationBody(entry.bindings, context, innerLocals)} }));`);
    }
  }
  return `const cleanups: Array<() => void> = [];
  try {
    ${statements.join("\n")}
    return () => { for (const cleanup of cleanups.reverse()) cleanup(); };
  } catch (error) { for (const cleanup of cleanups.reverse()) cleanup(); throw error; }`;
}

/** Compila una parte tipada de .meeko para SSR e hidratación del HTML existente. */
export function compile(source: string, filename = "anonymous.meeko"): CompileResult {
  const { script, template, style } = parseSfc(source, filename);
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
  const templateErrors: Array<{ code: string; startOffset: number }> = [];
  const parsed = parseFragment(template.content, {
    sourceCodeLocationInfo: true,
    onParseError(error) { templateErrors.push({ code: error.code, startOffset: error.startOffset }); },
  }) as unknown as TemplateNode;
  if (templateErrors[0]) {
    const error = templateErrors[0];
    throw compileError(source, filename, "MEEK008", `Invalid template HTML: ${error.code}`, template.contentStart + error.startOffset);
  }
  const bindingsForTemplate = emptyBindings();
  const context: TemplateContext = { source, filename, templateOffset: template.contentStart, scopeAttribute, nextText: 0, nextEvent: 0, nextAttribute: 0, nextRegion: 0 };
  const html = renderNode(parsed, bindingsForTemplate, context);
  const scriptParts = compileScript(script, source, filename);
  const bindings = scriptParts.names.join(", ");
  const code = `// Generated by Meeko. Edit the .meeko source instead.\nimport * as __meeko from "meeko";\n${scriptParts.imports.join("\n")}\n${scriptParts.types.join("\n")}\nfunction __setup(__props: ${scriptParts.propsType}) {\n${scriptParts.setup.join("\n")}\nreturn { ${bindings} };\n}\nexport type ComponentProps = ${scriptParts.propsType};\nexport const css = ${quote(css)};\nexport function renderToString(__inputProps: ComponentProps): string {\nreturn __meeko.createRoot((dispose) => {\nconst { ${bindings} } = __setup(__inputProps);\ntry { return ${html}; } finally { dispose(); }\n});\n}\nexport function hydrate(root: Element, __inputProps: ComponentProps): () => void {\nreturn __meeko.createRoot((dispose) => {\nconst { ${bindings} } = __setup(__inputProps);\nconst __scope: __meeko.DomScope = { root };\nconst __release = (() => { ${hydrationBody(bindingsForTemplate, context)} })();\nreturn () => { __release(); dispose(); };\n});\n}\n`;
  return { code, css };
}
