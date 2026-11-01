import ts from "@typescript/typescript6";

/** `const name = defineEmits<T>()` accepted by the compiler. */
export interface EmitsDeclaration {
  readonly declaration: ts.VariableDeclaration & { readonly name: ts.Identifier };
  readonly typeArgument: ts.TypeNode;
}

export class EmitsError extends Error {
  constructor(readonly code: string, message: string, readonly node: ts.Node) {
    super(message);
  }
}

/** Whether `node` is the identifier of a `defineEmits` reference, not a property name. */
function isMacroReference(node: ts.Node): node is ts.Identifier {
  if (!ts.isIdentifier(node) || node.text !== "defineEmits") return false;
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return false;
  return true;
}

/**
 * Finds the only `defineEmits` of a script. It must be called once, in its own top-level
 * `const` with a simple name, with one type argument and no runtime arguments.
 */
export function analyzeEmits(file: ts.SourceFile): EmitsDeclaration | undefined {
  let found: EmitsDeclaration | undefined;
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
        throw new EmitsError("MEEK045", "defineEmits debe aparecer una sola vez, en su propia declaración const de nivel superior con un nombre simple", node);
      }
      const typed = call as ts.CallExpression;
      if (typed.typeArguments?.length !== 1) throw new EmitsError("MEEK046", "defineEmits necesita un argumento de tipo, como defineEmits<{ save: [id: number] }>()", typed);
      if (typed.arguments.length > 0) throw new EmitsError("MEEK047", "defineEmits no admite argumentos en tiempo de ejecución; declara los eventos en su argumento de tipo", typed.arguments[0]!);
      found = { declaration: declaration as EmitsDeclaration["declaration"], typeArgument: typed.typeArguments[0]! };
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Name of a property of a type literal: an identifier, a string or a number; `undefined` when computed. */
function memberName(member: ts.TypeElement): string | undefined {
  const name = member.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

/** The members of a type literal, or of the type literal that a local `interface` or `type` declares. */
function literalMembers(type: ts.TypeNode, file: ts.SourceFile): readonly ts.TypeElement[] | undefined {
  if (ts.isParenthesizedTypeNode(type)) return literalMembers(type.type, file);
  if (ts.isTypeLiteralNode(type)) return type.members;
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName) || type.typeArguments?.length) return undefined;
  const name = type.typeName.text;
  for (const statement of file.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === name) {
      // `extends` brings members from elsewhere: the list would be partial.
      return statement.heritageClauses?.length || statement.typeParameters?.length ? undefined : statement.members;
    }
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name) {
      return statement.typeParameters?.length ? undefined : literalMembers(statement.type, file);
    }
  }
  return undefined;
}

/**
 * Events of `defineEmits<T>()` when the script itself spells them: `T` is a type literal, or a
 * local `interface` or `type` that is one. `undefined` when `T` comes from elsewhere (an import, an
 * `extends`, a mapped or generic type): the compiler then cannot list them.
 */
export function emitNames(typeArgument: ts.TypeNode, file: ts.SourceFile): string[] | undefined {
  const members = literalMembers(typeArgument, file);
  if (!members) return undefined;
  const names: string[] = [];
  for (const member of members) {
    if (!ts.isPropertySignature(member)) return undefined;
    const name = memberName(member);
    if (name === undefined) return undefined;
    names.push(name);
  }
  return names;
}

import { apiDocs, jsdoc } from "./compiler-docs";

export const defineEmitsDocs = jsdoc(
    "Macro de compilación: declara los eventos del componente. Cada clave de `T` es un evento y su valor,",
    "la tupla de argumentos. Devuelve `emit(evento, ...args)`, que llama a la prop de callback opcional",
    "`onEvento` que el padre pasa con `on:evento`; sin listener no hace nada.",
    "",
    "Una sola vez, en su propia declaración `const` de nivel superior (`MEEK045`), con argumento de tipo",
    "(`MEEK046`) y sin argumentos en tiempo de ejecución (`MEEK047`).",
    "",
    "@since 1.1.0",
    "@example",
    "```html",
    "<!-- TodoItem.meeko -->",
    "<script lang=\"ts\">",
    "const props = defineProps<{ id: number }>();",
    "const emit = defineEmits<{ save: [id: number]; close: [] }>();",
    "</script>",
    "<template><button on:click=\"() => emit('save', props.id)\">Guardar</button></template>",
    "",
    "<!-- En el padre -->",
    "<TodoItem bind:id=\"todo.id\" on:save=\"(id) => save(id)\" />",
    "```",
    `@see ${apiDocs}#eventos-de-componente-defineemits-y-on`,
  );
/** Constraint of a `defineEmits` type: every event maps to the tuple of its arguments. */
export type EmitMap<Events> = { [K in keyof Events]: readonly unknown[] };

/** Validates a `defineEmits` type argument where it is written. */
export type Emits<Events extends EmitMap<Events>> = Events;

/**
 * Argument tuple of an event. The other types do not repeat the `EmitMap` constraint, so an
 * invalid event map is reported once, on the `defineEmits` type argument.
 */
export type EmitArgs<Args> = Args extends readonly unknown[] ? Args : never;

/** Optional callback props that a parent sets with `on:event` or `bind:onEvent`. */
export type EmitProps<Events> = {
  [K in keyof Events & string as `on${Capitalize<K>}`]?: ((...args: EmitArgs<Events[K]>) => void) | undefined;
};

/** Function returned by `defineEmits`; it calls the parent callback if there is one. */
export type Emit<Events> = <K extends keyof Events & string>(name: K, ...args: EmitArgs<Events[K]>) => void;

/** Callback props of `defineEmits` that `defineProps` also declares. */
export type EmitConflicts<Props, Events> = Props extends unknown ? Extract<keyof Props, keyof EmitProps<Events>> : never;

/** `true` without conflicts; otherwise a message that names the duplicated props. */
export type NoEmitConflict<Props, Events> = [EmitConflicts<Props, Events>] extends [never]
  ? true
  : `defineEmits events conflict with defineProps props: ${EmitConflicts<Props, Events> & string}`;


