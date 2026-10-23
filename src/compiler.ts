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

function textParts(value: string, dynamics: DynamicText[], source: string, filename: string, offset: number): string[] {
  const parts: string[] = [];
  const pattern = /\{([^{}]+)\}/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index;
    const staticPart = value.slice(cursor, index);
    if (staticPart) parts.push(`__meeko.escapeHtml(${quote(staticPart)})`);
    const rawExpression = match[1] ?? "";
    const expression = rawExpression.trim();
    if (!expression) throw compileError(source, filename, "MEEK009", "Empty template expression", offset + index);
    validateExpression(expression, source, filename, offset + index + 1 + rawExpression.indexOf(expression));
    const id = dynamics.length;
    dynamics.push({ id, expression, offset: offset + index });
    parts.push(`${quote(`<!--meeko:text:${id}-->`)} + __meeko.escapeHtml(${expression}) + ${quote(`<!--/meeko:text:${id}-->`)}`);
    cursor = index + match[0].length;
  }
  const tail = value.slice(cursor);
  if (tail.includes("{")) throw compileError(source, filename, "MEEK010", "Unclosed template expression", offset + cursor + tail.indexOf("{"));
  if (tail) parts.push(`__meeko.escapeHtml(${quote(tail)})`);
  return parts;
}

function renderNode(node: TemplateNode, dynamics: DynamicText[], events: EventBinding[], attributes: AttributeBinding[], source: string, filename: string, templateOffset: number, scopeAttribute?: string): string {
  if (node.nodeName === "#text") {
    return textParts(node.value ?? "", dynamics, source, filename, templateOffset + (node.sourceCodeLocation?.startOffset ?? 0)).join(" + ") || quote("");
  }
  if (node.nodeName === "#comment") return quote(`<!--${node.value ?? ""}-->`);
  if (!node.tagName) return (node.childNodes ?? []).map((child) => renderNode(child, dynamics, events, attributes, source, filename, templateOffset, scopeAttribute)).join(" + ") || quote("");

  const attrs: Array<{ kind: "static"; value: string } | { kind: "dynamic"; expression: string }> = [];
  for (const attr of node.attrs ?? []) {
    if (attr.name.startsWith("on:")) {
      const name = attr.name.slice(3);
      if (!/^[a-z]+$/.test(name)) throw compileError(source, filename, "MEEK011", `Invalid event name: ${name}`, templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
      const id = events.length;
      validateExpression(attr.value, source, filename, templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
      events.push({ id, name, expression: attr.value });
      attrs.push({ kind: "static", value: ` data-meeko-e-${id}=""` });
    } else if (attr.name.startsWith("bind:")) {
      const name = attr.name.slice(5);
      if (!/^[a-z][a-z0-9:.-]*$/.test(name) || name.startsWith("on")) {
        throw compileError(source, filename, "MEEK012", `Invalid dynamic attribute: ${name}`, templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
      }
      validateExpression(attr.value, source, filename, templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
      const id = attributes.length;
      attributes.push({ id, name, expression: attr.value, offset: templateOffset + (node.sourceCodeLocation?.startOffset ?? 0) });
      attrs.push({ kind: "static", value: ` data-meeko-a-${id}=""` });
      attrs.push({ kind: "dynamic", expression: `__meeko.renderAttribute(${quote(name)}, ${attr.value})` });
    } else if (attr.name.startsWith(":")) {
      throw compileError(source, filename, "MEEK012", `Unsupported template directive: ${attr.name}`, templateOffset + (node.sourceCodeLocation?.startOffset ?? 0));
    } else {
      attrs.push({ kind: "static", value: ` ${attr.name}="${escapeAttribute(attr.value)}"` });
    }
  }
  if (scopeAttribute) attrs.push({ kind: "static", value: ` ${scopeAttribute}=""` });
  const openingParts: string[] = [quote(`<${node.tagName}`)];
  for (const attr of attrs) {
    if (attr.kind === "dynamic") openingParts.push(attr.expression);
    else openingParts.push(quote(attr.value));
  }
  openingParts.push(quote(">"));
  const opening = openingParts.join(" + ");
  const voidElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  if (voidElements.has(node.tagName)) return opening;
  const children = (node.childNodes ?? []).map((child) => renderNode(child, dynamics, events, attributes, source, filename, templateOffset, scopeAttribute));
  return [opening, ...children, quote(`</${node.tagName}>`)].join(" + ");
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
  const dynamics: DynamicText[] = [];
  const events: EventBinding[] = [];
  const attributes: AttributeBinding[] = [];
  const html = renderNode(parsed, dynamics, events, attributes, source, filename, template.contentStart, scopeAttribute);
  const scriptParts = compileScript(script, source, filename);
  const bindings = scriptParts.names.join(", ");
  const markerCases = dynamics.map(({ id, expression, offset }) => `
    {
      const marker = markers.get(${quote(`meeko:text:${id}`)});
      const text = marker?.nextSibling;
      if (!text || text.nodeType !== 3) throw new Error(${quote(`Missing text node in ${basename(filename)}:${locate(source, offset).line}:${locate(source, offset).column} (marker ${id})`)});
      if (text.textContent !== String(${expression})) throw new Error(${quote(`Hydration mismatch in ${basename(filename)}:${locate(source, offset).line}:${locate(source, offset).column} (text ${id})`)});
      cleanups.push(__meeko.effect(() => { text.textContent = String(${expression}); }));
    }`).join("\n");
  const eventCases = events.map(({ id, name, expression }) => `
    {
      const target = root.querySelector(${quote(`[data-meeko-e-${id}]`)});
      if (!target) throw new Error(${quote(`Missing event target ${id}`)});
      const listener = (event: Event): void => {
        const handler: (event: ${["click", "input", "change", "submit", "keydown", "keyup", "focus", "blur"].includes(name) ? `GlobalEventHandlersEventMap[${quote(name)}]` : "Event"}) => void = (${expression});
        handler(event as ${["click", "input", "change", "submit", "keydown", "keyup", "focus", "blur"].includes(name) ? `GlobalEventHandlersEventMap[${quote(name)}]` : "Event"});
      };
      target.addEventListener(${quote(name)}, listener);
      cleanups.push(() => target.removeEventListener(${quote(name)}, listener));
    }`).join("\n");
  const attributeCases = attributes.map(({ id, name, expression, offset }) => `
    {
      const target = root.querySelector(${quote(`[data-meeko-a-${id}]`)});
      if (!target) throw new Error(${quote(`Missing attribute target in ${basename(filename)}:${locate(source, offset).line}:${locate(source, offset).column} (${name})`)});
      const initial = __meeko.attributeValue(${quote(name)}, ${expression});
      if (target.getAttribute(${quote(name)}) !== initial) throw new Error(${quote(`Hydration mismatch in ${basename(filename)}:${locate(source, offset).line}:${locate(source, offset).column} (attribute ${name})`)});
      cleanups.push(__meeko.effect(() => {
        const next = __meeko.attributeValue(${quote(name)}, ${expression});
        if (next === null) target.removeAttribute(${quote(name)});
        else target.setAttribute(${quote(name)}, next);
      }));
    }`).join("\n");
  const code = `// Generated by Meeko. Edit the .meeko source instead.\nimport * as __meeko from "meeko";\n${scriptParts.imports.join("\n")}\n${scriptParts.types.join("\n")}\nfunction __setup(__props: ${scriptParts.propsType}) {\n${scriptParts.setup.join("\n")}\nreturn { ${bindings} };\n}\nexport type ComponentProps = ${scriptParts.propsType};\nexport const css = ${quote(css)};\nexport function renderToString(__inputProps: ComponentProps): string {\nreturn __meeko.createRoot((dispose) => {\nconst { ${bindings} } = __setup(__inputProps);\ntry { return ${html}; } finally { dispose(); }\n});\n}\nexport function hydrate(root: Element, __inputProps: ComponentProps): () => void {\nreturn __meeko.createRoot((dispose) => {\nconst { ${bindings} } = __setup(__inputProps);\nconst cleanups: Array<() => void> = [];\ntry {\nconst markers = new Map<string, Comment>();\nconst walker = root.ownerDocument.createTreeWalker(root, 128);\nwhile (walker.nextNode()) {\nconst comment = walker.currentNode as Comment;\nmarkers.set(comment.data, comment);\n}\n${markerCases}\n${attributeCases}\n${eventCases}\nreturn () => { for (const cleanup of cleanups) cleanup(); dispose(); };\n} catch (error) { for (const cleanup of cleanups) cleanup(); dispose(); throw error; }\n});\n}\n`;
  return { code, css };
}
