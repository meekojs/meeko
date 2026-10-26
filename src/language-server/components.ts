import ts from "@typescript/typescript6";
import type { VirtualComponent } from "./model.js";

/** A member of a component channel with its display type. */
export interface ComponentMember {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
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

const maximumType = 90;

function short(text: string): string {
  return text.length > maximumType ? `${text.slice(0, maximumType - 3)}...` : text;
}

/** Cada canal de un componente como tipo: de los alias de su módulo o de la comprobación de una etiqueta del padre. */
type ChannelTypes = (name: "props" | "events" | "models" | "snippets" | "exposed") => { type: ts.Type; at: ts.Node } | undefined;

function summarize(checker: ts.TypeChecker, channel: ChannelTypes, typeParameters: readonly string[] | undefined): ComponentSummary {
  const members = (name: Parameters<ChannelTypes>[0], value?: (type: ts.Type, at: ts.Node) => ts.Type): ComponentMember[] | undefined => {
    const found = channel(name);
    if (!found || found.type.flags & ts.TypeFlags.Null) return undefined;
    return checker.getPropertiesOfType(found.type).map((symbol) => {
      const optional = (symbol.flags & ts.SymbolFlags.Optional) !== 0;
      let type = checker.getTypeOfSymbolAtLocation(symbol, found.at);
      if (optional) type = checker.getNonNullableType(type);
      if (value) type = value(type, found.at);
      return { name: symbol.name, type: short(checker.typeToString(type, found.at)), optional };
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
  }, typeParameters);
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
    .map((symbol) => `${symbol.name} = ${short(checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, call), call))}`);
  return summarize(checker, (name) => {
    const type = part(name);
    return type ? { type, at: call } : undefined;
  }, typeParameters);
}

/** Markdown lines of a component summary for a hover. */
export function componentSummaryMarkdown(summary: ComponentSummary): string[] {
  const list = (items: readonly string[]): string => items.length ? items.join(", ") : "ninguno";
  const parameters = (tuple: string): string => tuple.startsWith("[") && tuple.endsWith("]") ? tuple.slice(1, -1) : tuple;
  const lines = [
    ...(summary.typeParameters ? [`**Parámetros de tipo:** ${list(summary.typeParameters.map((parameter) => `\`${parameter}\``))}`] : []),
    `**Props:** ${list(summary.props.map((prop) => `\`${prop.name}${prop.optional ? "?" : ""}: ${prop.type}\``))}`,
    `**Eventos:** ${list(summary.events.map((event) => `\`on:${event.name}(${parameters(event.type)})\``))}`,
    `**Modelos:** ${list(summary.models.map((model) => `\`${model.name === "default" ? "model" : `model:${model.name}`}${model.optional ? "?" : ""}\` (${model.type})`))}`,
    `**Snippets:** ${list(summary.snippets.map((snippet) => `\`${snippet.name}${snippet.optional ? "?" : ""}(${parameters(snippet.type)})\``))}`,
  ];
  if (summary.exposed) lines.push(`**Expone:** ${list(summary.exposed.map((member) => `\`${member.name}${member.optional ? "?" : ""}: ${member.type}\``))}`);
  return lines;
}
