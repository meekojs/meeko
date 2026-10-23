import { createHash } from "node:crypto";
import ts from "@typescript/typescript6";
import { parseFragment } from "parse5";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

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
}

interface DynamicText {
  id: number;
  expression: string;
}

interface EventBinding {
  id: number;
  name: string;
  expression: string;
}

/** Resultado del compilador de un componente .meeko. */
export interface CompileResult {
  code: string;
  css: string;
}

function section(source: string, tag: string): { content: string; attributes: string } | undefined {
  const match = new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "i").exec(source);
  return match ? { attributes: match[1] ?? "", content: match[2] ?? "" } : undefined;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function textParts(value: string, dynamics: DynamicText[]): string[] {
  const parts: string[] = [];
  const pattern = /\{([^{}]+)\}/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index;
    const staticPart = value.slice(cursor, index);
    if (staticPart) parts.push(`__meeko.escapeHtml(${quote(staticPart)})`);
    const expression = match[1]?.trim();
    if (!expression) throw new Error("Empty template expression");
    const id = dynamics.length;
    dynamics.push({ id, expression });
    parts.push(`${quote(`<!--meeko:text:${id}-->`)} + __meeko.escapeHtml(${expression}) + ${quote(`<!--/meeko:text:${id}-->`)}`);
    cursor = index + match[0].length;
  }
  const tail = value.slice(cursor);
  if (tail) parts.push(`__meeko.escapeHtml(${quote(tail)})`);
  return parts;
}

function renderNode(node: TemplateNode, dynamics: DynamicText[], events: EventBinding[], scopeAttribute?: string): string {
  if (node.nodeName === "#text") {
    return textParts(node.value ?? "", dynamics).join(" + ") || quote("");
  }
  if (node.nodeName === "#comment") return quote(`<!--${node.value ?? ""}-->`);
  if (!node.tagName) return (node.childNodes ?? []).map((child) => renderNode(child, dynamics, events, scopeAttribute)).join(" + ") || quote("");

  const attrs: string[] = [];
  for (const attr of node.attrs ?? []) {
    if (attr.name.startsWith("on:")) {
      const name = attr.name.slice(3);
      if (!/^[a-z]+$/.test(name)) throw new Error(`Invalid event name: ${name}`);
      const id = events.length;
      events.push({ id, name, expression: attr.value });
      attrs.push(` data-meeko-e-${id}=""`);
    } else if (attr.name.startsWith(":") || attr.name.startsWith("bind:")) {
      throw new Error(`Unsupported template directive: ${attr.name}`);
    } else {
      attrs.push(` ${attr.name}="${escapeAttribute(attr.value)}"`);
    }
  }
  if (scopeAttribute) attrs.push(` ${scopeAttribute}=""`);
  const opening = `<${node.tagName}${attrs.join("")}>`;
  const voidElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  if (voidElements.has(node.tagName)) return quote(opening);
  const children = (node.childNodes ?? []).map((child) => renderNode(child, dynamics, events, scopeAttribute));
  return [quote(opening), ...children, quote(`</${node.tagName}>`)].join(" + ");
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

function compileScript(script: string): { imports: string[]; types: string[]; setup: string[]; names: string[]; propsType: string } {
  const file = ts.createSourceFile("component.ts", script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
      if (statement.declarationList.declarations.length !== 1) throw new Error("Declare one variable per statement in .meeko scripts");
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) throw new Error("Only simple variable declarations are supported in .meeko scripts");
        const name = declaration.name.text;
        names.push(name);
        if (declaration.initializer && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(file) === "defineProps") {
          if (statement.declarationList.declarations.length !== 1 || propsType) throw new Error("defineProps must appear once in its own declaration");
          propsType = declaration.initializer.typeArguments?.[0]?.getText(file);
          if (!propsType) throw new Error("defineProps requires a type argument");
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
    throw new Error(`Unsupported top-level script statement: ${ts.SyntaxKind[statement.kind]}`);
  }
  return { imports, types, setup, names, propsType: propsType ?? "Record<string, never>" };
}

/** Compila una parte tipada de .meeko para SSR e hidratación del HTML existente. */
export function compile(source: string, filename = "anonymous.meeko"): CompileResult {
  const script = section(source, "script");
  const template = section(source, "template");
  const style = section(source, "style");
  if (!script || !/\blang\s*=\s*["']ts["']/i.test(script.attributes)) throw new Error("A <script lang=\"ts\"> section is required");
  if (!template) throw new Error("A <template> section is required");
  const scopeAttribute = style && /\bscoped\b/i.test(style.attributes)
    ? `data-meeko-s-${createHash("sha256").update(filename).digest("hex").slice(0, 8)}`
    : undefined;
  const css = scopeAttribute ? scopeCss(style?.content ?? "", scopeAttribute) : style?.content ?? "";
  const parsed = parseFragment(template.content) as unknown as TemplateNode;
  const dynamics: DynamicText[] = [];
  const events: EventBinding[] = [];
  const html = renderNode(parsed, dynamics, events, scopeAttribute);
  const scriptParts = compileScript(script.content);
  const bindings = scriptParts.names.join(", ");
  const markerCases = dynamics.map(({ id, expression }) => `
    {
      const marker = markers.get(${quote(`meeko:text:${id}`)});
      const text = marker?.nextSibling;
      if (!text || text.nodeType !== 3) throw new Error(${quote(`Missing text node for marker ${id}`)});
      if (text.textContent !== String(${expression})) throw new Error(${quote(`Hydration mismatch at text ${id}`)});
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
  const code = `// Generated by Meeko. Edit the .meeko source instead.\nimport * as __meeko from "meeko";\n${scriptParts.imports.join("\n")}\n${scriptParts.types.join("\n")}\nfunction __setup(__props: ${scriptParts.propsType}) {\n${scriptParts.setup.join("\n")}\nreturn { ${bindings} };\n}\nexport type ComponentProps = ${scriptParts.propsType};\nexport const css = ${quote(css)};\nexport function renderToString(__inputProps: ComponentProps): string {\nreturn __meeko.createRoot((dispose) => {\nconst { ${bindings} } = __setup(__inputProps);\ntry { return ${html}; } finally { dispose(); }\n});\n}\nexport function hydrate(root: Element, __inputProps: ComponentProps): () => void {\nreturn __meeko.createRoot((dispose) => {\nconst { ${bindings} } = __setup(__inputProps);\nconst cleanups: Array<() => void> = [];\ntry {\nconst markers = new Map<string, Comment>();\nconst walker = root.ownerDocument.createTreeWalker(root, 128);\nwhile (walker.nextNode()) {\nconst comment = walker.currentNode as Comment;\nmarkers.set(comment.data, comment);\n}\n${markerCases}\n${eventCases}\nreturn () => { for (const cleanup of cleanups) cleanup(); dispose(); };\n} catch (error) { for (const cleanup of cleanups) cleanup(); dispose(); throw error; }\n});\n}\n`;
  return { code, css };
}
