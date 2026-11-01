import ts from "@typescript/typescript6";

/** `const name = defineSnippets<T>()` accepted by the compiler. */
export interface SnippetsDeclaration {
  readonly declaration: ts.VariableDeclaration & { readonly name: ts.Identifier };
  readonly typeArgument: ts.TypeNode;
}

export class SnippetsError extends Error {
  constructor(readonly code: string, message: string, readonly node: ts.Node) {
    super(message);
  }
}

/** Whether `node` is the identifier of a `defineSnippets` reference, not a property name. */
function isMacroReference(node: ts.Node): node is ts.Identifier {
  if (!ts.isIdentifier(node) || node.text !== "defineSnippets") return false;
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return false;
  return true;
}

/**
 * Finds the only `defineSnippets` of a script. It must be called once, in its own top-level
 * `const` with a simple name, with one type argument and no runtime arguments.
 */
export function analyzeSnippets(file: ts.SourceFile): SnippetsDeclaration | undefined {
  let found: SnippetsDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (isMacroReference(node)) {
      const call = node.parent;
      const declaration = ts.isCallExpression(call) && call.expression === node ? call.parent : undefined;
      const list = declaration && ts.isVariableDeclaration(declaration) ? declaration.parent : undefined;
      const valid = declaration !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer === call
        && ts.isIdentifier(declaration.name)
        && list !== undefined && ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0 && list.declarations.length === 1
        && ts.isVariableStatement(list.parent) && ts.isSourceFile(list.parent.parent);
      if (!valid || found) {
        throw new SnippetsError("MEEK059", "defineSnippets debe aparecer una sola vez, en su propia declaración const de nivel superior con un nombre simple", node);
      }
      const typed = call as ts.CallExpression;
      if (typed.typeArguments?.length !== 1) throw new SnippetsError("MEEK060", "defineSnippets necesita un argumento de tipo, como defineSnippets<{ default: [] }>()", typed);
      if (typed.arguments.length > 0) throw new SnippetsError("MEEK060", "defineSnippets no admite argumentos en tiempo de ejecución; declara los snippets en su argumento de tipo", typed.arguments[0]!);
      found = { declaration: declaration as SnippetsDeclaration["declaration"], typeArgument: typed.typeArguments[0]! };
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** `node` without the parentheses around it. */
function unparenthesized(node: ts.TypeNode): ts.TypeNode {
  return ts.isParenthesizedTypeNode(node) ? unparenthesized(node.type) : node;
}

/** Whether `node` is a mapped type, written in place or as a type alias of the same script. */
function isMappedMember(node: ts.TypeNode, file: ts.SourceFile): boolean {
  const type = unparenthesized(node);
  if (ts.isMappedTypeNode(type)) return true;
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) return false;
  const name = type.typeName.text;
  const alias = file.statements.find((statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === name);
  return alias !== undefined && ts.isMappedTypeNode(unparenthesized(alias.type));
}

/**
 * Members of a `defineSnippets` type that the component reads one by one: an intersection with a
 * mapped type, such as `` { [K in keyof Row & string as `cell-${K}`]?: [row: Row, value: Row[K]] } & { cell?: [] } ``.
 * Over a type parameter, TypeScript cannot read `cell` from the whole intersection (`T["cell"]`
 * stays deferred), but it can from the map of each member, so the compiler types the component's
 * own `snippets` as `SnippetMap<A> & SnippetMap<B>`. `undefined` for any other type, which keeps a
 * single `SnippetMap<T>`, so `typeof snippets` does not change for it.
 */
export function snippetTypeParts(typeArgument: ts.TypeNode, file: ts.SourceFile): readonly ts.TypeNode[] | undefined {
  const type = unparenthesized(typeArgument);
  if (!ts.isIntersectionTypeNode(type) || !type.types.some((member) => isMappedMember(member, file))) return undefined;
  return type.types;
}

import { jsdoc } from "./compiler-docs";

export const defineSnippetsDocs = jsdoc(
    "Macro de compilación: declara los snippets del componente, contenido de plantilla que el padre",
    "escribe entre las etiquetas del hijo. Cada clave de `T` es un snippet y su valor, la tupla de",
    "parámetros que el hijo le pasa; una clave opcional (`title?: []`) hace opcional el snippet.",
    "",
    "El contenido suelto entre las etiquetas es el snippet `default`; los demás se escriben con",
    "`<snippet name=\"...\" params=\"...\">`. El hijo los coloca con `<render snippet=\"...\" args=\"...\" />`.",
    "El contenido pertenece al padre: lee su ámbito y sus señales. Una sola vez, en su propia",
    "declaración `const` de nivel superior (`MEEK059`).",
    "",
    "Desde `1.4`, el valor de una clave también puede ser un `Snippet<Args>`, que cuenta como",
    "`Args`: así se reutilizan los snippets de otro componente con `Omit`, `Pick` o `&`, por",
    "ejemplo `defineSnippets<Omit<AppCardSnippets, \"footer\"> & { actions?: [close: () => void] }>()`.",
    "",
    "Desde `1.8`, un nombre puede llevar guiones (`<snippet name=\"cell-email\">`, `snippets['cell-email']`)",
    "y las claves pueden salir de un tipo mapeado sobre un genérico, como",
    "``{ [K in keyof Row & string as `cell-${K}`]?: [row: Row, value: Row[K]] }``: el padre recibe",
    "`value` con el tipo de cada columna.",
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
  );
import type { ChannelsOf } from "../runtime/channels";
import type { Snippet } from "../runtime/snippets";

/**
 * What each key of a `defineSnippets` type may hold: the tuple of its parameters or, since 1.4, a
 * `Snippet<Args>`, as in the `ComponentSnippets` (or `AppCardSnippets`) of another component.
 */
type SnippetEntry = readonly unknown[] | Snippet<never>;

/**
 * Constraint of a `defineSnippets` type: every snippet maps to its parameters, as a tuple or a
 * `Snippet`. Since 1.8 the index-signature member also accepts mapped types over a type parameter,
 * such as `` { [K in keyof Row & string as `cell-${K}`]?: [row: Row, value: Row[K]] } ``, whose keys
 * TypeScript cannot list; the mapped member keeps interfaces valid.
 */
export type SnippetTypes<T extends { readonly [name: string]: SnippetEntry | undefined } | { [K in keyof T]: SnippetEntry }> = T;

/**
 * Parameter tuple of a snippet type: the tuple itself or the `Args` of a `Snippet<Args>`.
 * Distributive, so the `undefined` of an optional snippet drops out.
 */
type SnippetParameters<Entry> = Entry extends readonly unknown[] ? Entry : Entry extends Snippet<infer Args extends readonly unknown[]> ? Args : never;

/** Snippets of a `defineSnippets` type, with its optional names; a `Snippet` entry stays as it is. */
export type SnippetMap<T> = { [K in keyof T]: Snippet<SnippetParameters<T[K]>> };

/** Parameters of the snippet `name` of a compiled component, or `any[]` if it has none by that name. */
export type SnippetArgs<Module, Name extends string> = ChannelsOf<Module> extends { readonly snippets: infer Snippets }
  ? Snippets extends object
    ? Name extends keyof Snippets ? (NonNullable<Snippets[Name]> extends Snippet<infer Args> ? Args : any[]) : any[]
    : any[]
  : any[];


