import ts from "@typescript/typescript6";
import type { Location } from "vscode-languageserver/node";
import { builtinTag } from "./builtin-tags.js";
import type { BuiltinTag } from "./builtin-tags.js";
import { componentMemberDocs, componentSignature, memberDocumentation, typeFormat } from "./components.js";
import type { ComponentMember, ComponentSummary } from "./components.js";
import { locationOf } from "./features.js";
import type { FeatureContext } from "./features.js";
import { positionLink } from "./insights.js";
import type { ComponentTag } from "./model.js";

/** The props type of a built-in tag in the virtual code (`MeekoLinkProps<"/users/[id]">`) and the interface that declares it. */
interface BuiltinProps {
  readonly checker: ts.TypeChecker;
  readonly type: ts.Type;
  readonly at: ts.Node;
  readonly declaration?: ts.Declaration & { readonly name?: ts.Node };
}

function builtinProps(context: FeatureContext, tag: ComponentTag, suffix = ""): BuiltinProps | undefined {
  const program = context.project.service.getProgram();
  const file = program?.getSourceFile(context.component.virtualFilename);
  const name = tag.builtin && `${tag.builtin.alias}${suffix}`;
  const alias = file?.statements.find((statement): statement is ts.TypeAliasDeclaration =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === name);
  if (!program || !alias) return undefined;
  const checker = program.getTypeChecker();
  const type = checker.getTypeAtLocation(alias.name);
  // A package before 1.4 does not declare the props type: the table describes the tag instead.
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return undefined;
  const declaration = type.getSymbol()?.declarations?.[0] ?? type.aliasSymbol?.declarations?.[0];
  return { checker, type, at: alias, ...(declaration ? { declaration } : {}) };
}

/** The props of a built-in tag as attributes (`bind:params?: { id: string }`), from the package's type or the table. */
function builtinMembers(tag: BuiltinTag, props: BuiltinProps | undefined): ComponentMember[] {
  const attribute = (name: string): string => tag.props.find((prop) => prop.name === name)?.attributes[0] ?? name;
  if (!props) {
    return tag.props.map((prop) => ({ name: prop.attributes[0]!, type: prop.type, optional: prop.optional, documentation: prop.documentation }));
  }
  const { checker, type, at } = props;
  return checker.getPropertiesOfType(type).map((symbol) => {
    const optional = (symbol.flags & ts.SymbolFlags.Optional) !== 0;
    let member = checker.getTypeOfSymbolAtLocation(symbol, at);
    if (optional) member = checker.getNonNullableType(member);
    const documentation = memberDocumentation(checker, symbol);
    return { name: attribute(symbol.name), type: checker.typeToString(member, at, typeFormat), optional, ...(documentation ? { documentation } : {}) };
  });
}

/**
 * The snippets of a built-in tag: one per theme of the application for `<MeekoThemeToggle>`, from
 * {@link BuiltinTag.snippetsType}, or those of the table.
 */
function builtinSnippets(context: FeatureContext, tag: ComponentTag, builtin: BuiltinTag): ComponentSummary["snippets"] {
  const fromTable = (snippet: BuiltinTag["snippets"][number]): ComponentMember => ({ name: snippet.name, type: `[${snippet.parameters}]`, optional: snippet.optional, documentation: snippet.documentation });
  const typed = builtin.snippetsType ? builtinProps(context, tag, "Snippets") : undefined;
  const names = typed ? typed.checker.getPropertiesOfType(typed.type) : [];
  // Without the generated declarations of the themes the type is an index signature: the table's.
  if (!typed || !names.length) return builtin.snippets.map(fromTable);
  return names.map((symbol) => {
    const known = builtin.snippets.find((snippet) => snippet.name === symbol.name);
    return {
      name: symbol.name, type: "[]", optional: (symbol.flags & ts.SymbolFlags.Optional) !== 0,
      documentation: known?.documentation ?? `Icono de la elección \`${symbol.name}\`; sin él se pinta su nombre.`,
    };
  });
}

/**
 * Hover of `<MeekoLink>`, `<MeekoOutlet />` and the other built-in tags: their props with the types
 * of `@meekojs/meeko/framework` (the routes of `to`, the `params` of that route…), their content,
 * what they render and a link to the guide. `undefined` for a component tag.
 */
export function builtinTagHover(context: FeatureContext, tag: ComponentTag): string | undefined {
  const builtin = tag.builtin && builtinTag(tag.builtin.name);
  if (!builtin) return undefined;
  const props = builtinProps(context, tag);
  const summary: ComponentSummary = {
    props: builtinMembers(builtin, props),
    events: [],
    models: [],
    snippets: builtinSnippets(context, tag, builtin),
  };
  const location = props && builtinTagDefinition(context, tag)?.[0];
  const kind = builtin.element ? `Etiqueta de Meeko · renderiza \`<${builtin.element}>\``
    : builtin.component ? "Etiqueta de Meeko · componente" : "Etiqueta de Meeko";
  return [
    ["```ts", componentSignature(summary, builtin.name), "```"].join("\n"),
    location ? `${kind} · props: [\`${builtin.propsType}\`](${positionLink(location.uri, location.range.start.line, location.range.start.character)})` : kind,
    builtin.summary,
    ...componentMemberDocs(summary),
    `[Guía de \`<${builtin.name}>\`](${builtin.guide})`,
  ].join("\n\n");
}

/** "Go to definition" of a built-in tag: the interface of its props in `@meekojs/meeko/framework`. */
export function builtinTagDefinition(context: FeatureContext, tag: ComponentTag): Location[] | undefined {
  const declaration = builtinProps(context, tag)?.declaration;
  if (!declaration) return undefined;
  const node = declaration.name ?? declaration;
  const file = node.getSourceFile();
  const location = locationOf(context, file.fileName, { start: node.getStart(file), length: node.getWidth(file) });
  return location ? [location] : undefined;
}
