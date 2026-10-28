import ts from "@typescript/typescript6";
import type { VirtualComponent } from "./model.js";

/** A member of a component channel with its display type. */
export interface ComponentMember {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
  /** JSDoc of the member as Markdown, if it has one. */
  readonly documentation?: string;
}

/** What a parent can pass to and receive from a component, read from its virtual module. */
export interface ComponentSummary {
  /**
   * `generic` de un componente genérico: cada parámetro como se declara (`T extends { id: string }`)
   * o, en una etiqueta del padre, resuelto a partir de sus props (`T = User`).
   */
  readonly typeParameters?: readonly string[];
  readonly props: readonly ComponentMember[];
  /** `defineEmits`: the event name and the arguments as a tuple, such as `[id: number]`. */
  readonly events: readonly ComponentMember[];
  /** `defineModel`: `default` is the model of `model="…"`; the type is the signal's value. */
  readonly models: readonly ComponentMember[];
  /** `defineSnippets`: the parameters as a tuple. */
  readonly snippets: readonly ComponentMember[];
  /** `defineExpose`: the members a `ref:` of the parent receives; `undefined` without defineExpose. */
  readonly exposed?: readonly ComponentMember[];
}

const maximumType = 120;

function short(text: string): string {
  return text.length > maximumType ? `${text.slice(0, maximumType - 3)}...` : text;
}

/** Alias names as written (`CardVariant`, not its union), without `import("…")` qualifiers. */
export const typeFormat = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

/** `{@link X}`, `{@link X texto}` o `{@link https://… texto}` como Markdown legible. */
function linkMarkdown(name: string, text: string): string {
  let target = name.trim();
  let label = text.trim();
  // `{@link https://example.com texto}`: TypeScript gives the URL and the label as one text part.
  if (!target && /^https?:\/\//.test(label)) {
    const space = label.search(/\s/);
    target = space < 0 ? label : label.slice(0, space);
    label = space < 0 ? "" : label.slice(space).trim();
  }
  if (/^https?:\/\//.test(target)) return `[${label || target}](${target})`;
  if (label) return label;
  return target ? `\`${target}\`` : "";
}

/**
 * Documentación de TypeScript como Markdown: igual que `displayPartsToString`, pero cada
 * `{@link}`, `{@linkcode}` o `{@linkplain}` queda como su texto, un nombre en código o un enlace.
 */
export function documentationMarkdown(parts: readonly ts.SymbolDisplayPart[] | undefined): string {
  let result = "";
  let link: { name: string; text: string } | undefined;
  for (const part of parts ?? []) {
    if (part.kind === "link") {
      if (part.text.startsWith("{@")) link = { name: "", text: "" };
      else if (link) {
        result += linkMarkdown(link.name, link.text);
        link = undefined;
      }
      continue;
    }
    if (link) {
      if (part.kind === "linkName") link.name += part.text;
      else link.text += part.text;
      continue;
    }
    result += part.text;
  }
  if (link) result += linkMarkdown(link.name, link.text);
  return result;
}

/** JSDoc of a member as Markdown, or `undefined`. */
export function memberDocumentation(checker: ts.TypeChecker, symbol: ts.Symbol): string | undefined {
  const text = documentationMarkdown(symbol.getDocumentationComment(checker)).trim();
  return text || undefined;
}

/**
 * The type a prop declares (`CardVariant`), when it is the type the props resolve to. An optional
 * prop's resolved type loses its alias with `undefined`; the declaration keeps it.
 */
function declaredType(checker: ts.TypeChecker, symbol: ts.Symbol, resolved: ts.Type): ts.Type | undefined {
  const declaration = symbol.declarations?.[0];
  const node = declaration && (ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration)) ? declaration.type : undefined;
  if (!node) return undefined;
  const declared = checker.getTypeFromTypeNode(node);
  return checker.isTypeAssignableTo(declared, resolved) && checker.isTypeAssignableTo(resolved, declared) ? declared : undefined;
}

/** Cada canal de un componente como tipo: de los alias de su módulo o de la comprobación de una etiqueta del padre. */
type ChannelTypes = (name: "props" | "events" | "models" | "snippets" | "exposed") => { type: ts.Type; at: ts.Node } | undefined;

function summarize(checker: ts.TypeChecker, channel: ChannelTypes, typeParameters: readonly string[] | undefined, declared: boolean): ComponentSummary {
  const members = (name: Parameters<ChannelTypes>[0], value?: (type: ts.Type, at: ts.Node) => ts.Type): ComponentMember[] | undefined => {
    const found = channel(name);
    if (!found || found.type.flags & ts.TypeFlags.Null) return undefined;
    return checker.getPropertiesOfType(found.type).map((symbol) => {
      const optional = (symbol.flags & ts.SymbolFlags.Optional) !== 0;
      let type = checker.getTypeOfSymbolAtLocation(symbol, found.at);
      if (optional) type = checker.getNonNullableType(type);
      if (value) type = value(type, found.at);
      else if (declared && name === "props") type = declaredType(checker, symbol, type) ?? type;
      const documentation = memberDocumentation(checker, symbol);
      return { name: symbol.name, type: short(checker.typeToString(type, found.at, typeFormat)), optional, ...(documentation ? { documentation } : {}) };
    });
  };
  const events = members("events") ?? [];
  const callbacks = new Set(events.map((event) => `on${event.name.charAt(0).toUpperCase()}${event.name.slice(1)}`));
  const props = (members("props") ?? []).filter((prop) => !callbacks.has(prop.name));
  // A model is a Signal<T>: the parent binds a signal of T.
  const models = members("models", (type, at) => {
    const value = type.getProperty("value");
    return value ? checker.getTypeOfSymbolAtLocation(value, at) : type;
  }) ?? [];
  // A snippet is Snippet<A>: show the parameters A.
  const snippets = members("snippets", (type) => {
    const snippet = checker.getNonNullableType(type);
    const reference = (snippet.flags & ts.TypeFlags.Object) !== 0 && ((snippet as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0;
    return (reference ? checker.getTypeArguments(snippet as ts.TypeReference)[0] : undefined) ?? snippet;
  }) ?? [];
  const exposed = members("exposed");
  return { ...(typeParameters?.length ? { typeParameters } : {}), props, events, models, snippets, ...(exposed ? { exposed } : {}) };
}

/**
 * Props, eventos, modelos, snippets y miembros expuestos de un componente, a partir de la forma de
 * módulo que el editor declara para cada `.meeko` (`ComponentProps`, `ComponentModels`...). Un
 * componente genérico muestra sus parámetros de tipo tal como los declaran los tipos del módulo.
 */
export function componentSummary(program: ts.Program, component: VirtualComponent): ComponentSummary | undefined {
  const file = program.getSourceFile(component.virtualFilename);
  if (!file) return undefined;
  const checker = program.getTypeChecker();
  const aliases = new Map<string, ts.TypeAliasDeclaration>();
  for (const statement of file.statements) if (ts.isTypeAliasDeclaration(statement)) aliases.set(statement.name.text, statement);
  const names = { props: "ComponentProps", events: "__MeekoEmits", models: "ComponentModels", snippets: "ComponentSnippets", exposed: "ComponentExposed" } as const;
  const props = aliases.get("ComponentProps");
  const typeParameters = props?.typeParameters?.map((parameter) => parameter.getText(file));
  return summarize(checker, (name) => {
    const alias = aliases.get(names[name]);
    return alias ? { type: checker.getTypeAtLocation(alias.name), at: alias } : undefined;
  }, typeParameters, true);
}

/**
 * El mismo resumen para una etiqueta del padre: `call` es su comprobación de etiqueta, cuyo
 * resultado tipa cada canal con los parámetros de tipo que infieren las props de la etiqueta.
 */
export function tagSummary(checker: ts.TypeChecker, call: ts.CallExpression): ComponentSummary | undefined {
  const result = checker.getTypeAtLocation(call);
  const part = (name: string): ts.Type | undefined => {
    const symbol = result.getProperty(name);
    return symbol ? checker.getTypeOfSymbolAtLocation(symbol, call) : undefined;
  };
  const typeArguments = part("typeArguments");
  if (!typeArguments || !part("props")) return undefined;
  const typeParameters = checker.getPropertiesOfType(typeArguments)
    .map((symbol) => `${symbol.name} = ${short(checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, call), call, typeFormat))}`);
  return summarize(checker, (name) => {
    const type = part(name);
    return type ? { type, at: call } : undefined;
  }, typeParameters, false);
}

/** `[id: number]` as `id: number`, the parameters of an event or a snippet. */
function parameters(tuple: string): string {
  return tuple.startsWith("[") && tuple.endsWith("]") ? tuple.slice(1, -1) : tuple;
}

/**
 * The signature of a component as its tag, for a TypeScript code block: one line per prop
 * (`variant?: CardVariant`), event (`on:save(id: number)`) and model (`model:open?: boolean`), and
 * its snippets (`header?()`) as its content. Empty channels are left out.
 */
export function componentSignature(summary: ComponentSummary, name: string): string {
  const optional = (member: ComponentMember): string => member.optional ? "?" : "";
  const attributes = [
    ...summary.props.map((prop) => `${prop.name}${optional(prop)}: ${prop.type}`),
    ...summary.events.map((event) => `on:${event.name}(${parameters(event.type)})`),
    ...summary.models.map((model) => `${model.name === "default" ? "model" : `model:${model.name}`}${optional(model)}: ${model.type}`),
  ];
  const open = `<${name}${summary.typeParameters ? `<${summary.typeParameters.join(", ")}>` : ""}`;
  const lines = !attributes.length
    ? [summary.snippets.length ? `${open}>` : `${open} />`]
    : [open, ...attributes.map((attribute) => `  ${attribute}`), summary.snippets.length ? ">" : "/>"];
  if (summary.snippets.length) {
    lines.push(...summary.snippets.map((snippet) => `  ${snippet.name}${optional(snippet)}(${parameters(snippet.type)})`), `</${name}>`);
  }
  if (summary.exposed) {
    lines.push("// ref: expone", ...summary.exposed.length ? summary.exposed.map((member) => `${member.name}${optional(member)}: ${member.type}`) : ["{}"]);
  }
  return lines.join("\n");
}

/** The JSDoc of each documented member, grouped by channel; empty groups are left out. */
export function componentMemberDocs(summary: ComponentSummary): string[] {
  const groups: Array<[string, readonly ComponentMember[], (member: ComponentMember) => string]> = [
    ["Props", summary.props, (member) => member.name],
    ["Eventos", summary.events, (member) => `on:${member.name}`],
    ["Modelos", summary.models, (member) => member.name === "default" ? "model" : `model:${member.name}`],
    ["Snippets", summary.snippets, (member) => member.name],
    ["Expone", summary.exposed ?? [], (member) => member.name],
  ];
  return groups.flatMap(([title, members, label]) => {
    const documented = members.filter((member) => member.documentation);
    // A list item keeps a multi-line JSDoc inside it.
    return documented.length
      ? [`**${title}**\n${documented.map((member) => `- \`${label(member)}\`: ${member.documentation!.replace(/\n/g, "\n  ")}`).join("\n")}`]
      : [];
  });
}

/**
 * Markdown of a component for a hover: its signature in a TypeScript block, a link to its file
 * and the JSDoc of its members.
 */
export function componentSummaryMarkdown(summary: ComponentSummary, name: string, file?: { readonly label: string; readonly uri: string }): string {
  return [
    ["```ts", componentSignature(summary, name), "```"].join("\n"),
    ...(file ? [`Componente · [${file.label}](${file.uri})`] : []),
    ...componentMemberDocs(summary),
  ].join("\n\n");
}
