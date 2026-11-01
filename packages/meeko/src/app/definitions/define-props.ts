import ts from "@typescript/typescript6";

/** A `defineProps(...)` call anywhere inside `node`; only a top-level declaration accepts it. */
export function definePropsCall(node: ts.Node): ts.CallExpression | undefined {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineProps") return node;
  return ts.forEachChild(node, definePropsCall);
}

/** The initializer of a `defineProps` declaration, if this declaration uses the macro. */
export function definePropsInitializer(declaration: ts.VariableDeclaration): ts.CallExpression | undefined {
  const initializer = declaration.initializer;
  return initializer && ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) && initializer.expression.text === "defineProps"
    ? initializer
    : undefined;
}

/** Type and defaults declared by a valid top-level `defineProps` binding. */
export interface PropsDeclaration {
  readonly typeArgument: ts.TypeNode | undefined;
  readonly defaults: PropsDefaults | undefined;
}

export function analyzePropsDeclaration(call: ts.CallExpression): PropsDeclaration {
  return { typeArgument: call.typeArguments?.[0], defaults: analyzePropsDefaults(call) };
}

/** A local interface passed to defineProps should use the shared component convention. */
export function nonstandardLocalPropsInterface(call: ts.CallExpression, file: ts.SourceFile): ts.Identifier | undefined {
  const argument = call.typeArguments?.[0];
  if (!argument || !ts.isTypeReferenceNode(argument) || !ts.isIdentifier(argument.typeName)) return undefined;
  const name = argument.typeName;
  if (name.text === "Props") return undefined;
  return file.statements.some((statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === name.text)
    ? name
    : undefined;
}

/** AST analysis shared by the compiler and the editor for defineProps defaults. */
export interface PropsDefaults {
  readonly argument: ts.ObjectLiteralExpression;
  readonly keys: readonly string[];
}

export class PropsDefaultsError extends Error {
  constructor(readonly code: string, message: string, readonly node: ts.Node) {
    super(message);
  }
}

export function analyzePropsDefaults(call: ts.CallExpression): PropsDefaults | undefined {
  if (call.arguments.length === 0) return undefined;
  if (call.arguments.length !== 1 || !ts.isObjectLiteralExpression(call.arguments[0]!)) {
    throw new PropsDefaultsError("MEEK040", "Los valores por defecto de defineProps necesitan un solo objeto literal", call.arguments[0] ?? call);
  }
  const argument = call.arguments[0];
  const keys: string[] = [];
  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property) ||
      !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      throw new PropsDefaultsError("MEEK041", "Los valores por defecto de defineProps necesitan propiedades con nombre", property);
    }
    const key = property.name.text;
    if (key === "__proto__" || keys.includes(key)) {
      throw new PropsDefaultsError("MEEK042", `Valor por defecto de prop duplicado o inseguro: ${key}`, property.name);
    }
    keys.push(key);
  }
  return { argument, keys };
}

import { apiDocs, jsdoc } from "./compiler-docs";
import { bindingNames, isValueReference, rootReferences } from "./scope";

export const definePropsDocs = jsdoc(
    "Macro de compilación: declara las props del componente con el tipo `T` y devuelve el objeto de props.",
    "No se importa ni existe en tiempo de ejecución.",
    "",
    "El argumento opcional es un objeto literal de valores por defecto: esas props pasan a ser opcionales",
    "para el padre y, dentro del componente, nunca son `undefined`. Debe aparecer una sola vez, en su",
    "propia declaración (`MEEK016`), y con argumento de tipo (`MEEK017`).",
    "Una interfaz declarada en este mismo <script> debe llamarse `Props` (`MEEK120`, aviso).",
    "",
    "Desde 1.8 se puede desestructurar: cada nombre lee su prop donde se usa y sigue siendo reactivo;",
    "los defaults van en el patrón (`count = 0`) y `...rest` es una vista de las demás props.",
    "",
    "@example",
    "```html",
    "<script lang=\"ts\">",
    "interface Props { title: string; count?: number }",
    "const props = defineProps<Props>({ count: 0 });",
    "</script>",
    "<template><h2>{props.title} ({props.count})</h2></template>",
    "```",
    "@example",
    "```html",
    "<script lang=\"ts\">",
    "const { title, count = 0, ...rest } = defineProps<{ title: string; count?: number; id?: string }>();",
    "</script>",
    "<template><h2 bind=\"rest\">{title} ({count})</h2></template>",
    "```",
    `@see ${apiDocs}#valores-por-defecto-en-defineprops`,
    `@see ${apiDocs}#desestructurar-las-props`,
  );

/** A name that a destructured `defineProps` declares: `label`, `type = "button"`, `class: className`. */
export interface PropsPatternBinding {
  /** The prop it reads. */
  readonly key: string;
  /** The local name, which reads `props[key]` wherever the script or the template uses it. */
  readonly name: ts.Identifier;
  /** The node that names the prop: the property name of `class: className`, or the local name. */
  readonly keyNode: ts.Node;
  /** The default value of the pattern (`= "button"`). */
  readonly initializer: ts.Expression | undefined;
}

/** A destructuring of `defineProps`: its names and its rest view (`...rest`). */
export interface PropsPattern {
  readonly bindings: readonly PropsPatternBinding[];
  readonly rest: ts.Identifier | undefined;
}

const patternHint = "desestructura cada prop con un nombre simple, como const { title, size = \"md\", ...rest } = defineProps<Props>(), o asígnalo a un nombre, como const props = defineProps<Props>(), y lee props.title";

/**
 * Validates a destructured `defineProps` (`MEEK015`): an object pattern of `const`, with one name per
 * prop, an optional default and a final `...rest`. Nested patterns are rejected: the inner value
 * would be a copy, not a read of the prop.
 */
export function analyzePropsPattern(declaration: ts.VariableDeclaration): PropsPattern {
  const pattern = declaration.name;
  if (ts.isArrayBindingPattern(pattern)) {
    throw new PropsDefaultsError("MEEK015", `defineProps devuelve un objeto, no un array: ${patternHint}`, pattern);
  }
  if (!ts.isObjectBindingPattern(pattern)) throw new PropsDefaultsError("MEEK015", patternHint, pattern);
  if ((declaration.parent.flags & ts.NodeFlags.Const) === 0) {
    throw new PropsDefaultsError("MEEK015", `Las props desestructuradas de defineProps se declaran con const, porque son de sólo lectura; ${patternHint}`, declaration.parent);
  }
  const bindings: PropsPatternBinding[] = [];
  let rest: ts.Identifier | undefined;
  for (const element of pattern.elements) {
    if (element.dotDotDotToken) {
      if (!ts.isIdentifier(element.name)) throw new PropsDefaultsError("MEEK015", `El resto de defineProps necesita un nombre simple, como ...rest; ${patternHint}`, element.name);
      rest = element.name;
      continue;
    }
    const property = element.propertyName;
    if (property && ts.isComputedPropertyName(property)) {
      throw new PropsDefaultsError("MEEK015", `defineProps no admite claves calculadas al desestructurar; ${patternHint}`, property);
    }
    const key = property ? (ts.isIdentifier(property) || ts.isStringLiteral(property) || ts.isNumericLiteral(property) ? property.text : property.getText()) : undefined;
    if (!ts.isIdentifier(element.name)) {
      throw new PropsDefaultsError("MEEK015", `defineProps no admite desestructuración anidada: el valor interior sería una copia que no sigue a la prop. Desestructura la prop entera, como const { ${key ?? "item"} } = defineProps<Props>(), y lee sus campos donde los uses`, element.name);
    }
    const prop = key ?? element.name.text;
    if (prop === "__proto__" || bindings.some((binding) => binding.key === prop)) {
      throw new PropsDefaultsError("MEEK042", `Valor por defecto de prop duplicado o inseguro: ${prop}`, property ?? element.name);
    }
    bindings.push({ key: prop, name: element.name, keyNode: property ?? element.name, initializer: element.initializer });
  }
  return { bindings, rest };
}

/** Longest default text that the editor shows; a longer one ends in `…`. */
const defaultTextLimit = 60;

/**
 * The default values of a `defineProps` declaration as written, by prop: from the argument
 * (`{ size: "md" }`) or from the destructuring (`size = "md"`). Tolerant of invalid code, for the
 * editor; the compiler reports it. Each text is on one line and at most 60 characters long.
 *
 * @example
 * propsDefaultTexts(declaration, file) // Map { "size" => "\"md\"", "tags" => "[]" }
 */
export function propsDefaultTexts(declaration: ts.VariableDeclaration, file: ts.SourceFile): Map<string, string> {
  const texts = new Map<string, string>();
  for (const [key, value] of propsDefaultExpressions(declaration)) {
    const text = value.getText(file).replace(/\s+/g, " ");
    texts.set(key, text.length > defaultTextLimit ? `${text.slice(0, defaultTextLimit - 1)}…` : text);
  }
  return texts;
}

/** The literal type of a literal expression (`"a"`, `-1`, `true`, `null`, `"a" as const`), if it is one. */
function literalTypeText(expression: ts.Expression, file: ts.SourceFile, names: ReadonlyMap<string, TopLevelName>, visiting: Set<string>): string | undefined {
  let node = expression;
  while (ts.isParenthesizedExpression(node) || (ts.isAsExpression(node) && ts.isConstTypeReference(node.type)) || ts.isSatisfiesExpression(node)) node = node.expression;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return JSON.stringify(node.text);
  if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) return node.getText(file);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && (ts.isNumericLiteral(node.operand) || ts.isBigIntLiteral(node.operand))) return `-${node.operand.getText(file)}`;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (node.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (node.kind === ts.SyntaxKind.NullKeyword) return "null";
  // A top-level constant of a literal, as the defaults read it (`kind = DEFAULT_KIND`).
  if (ts.isIdentifier(node) && !visiting.has(node.text)) {
    const entry = names.get(node.text);
    if (entry?.kind !== "constant") return undefined;
    const declaration = entry.statement.declarationList.declarations[0];
    if (declaration?.type) return undefined;
    visiting.add(node.text);
    const type = literalTypeText(entry.initializer, file, names, visiting);
    visiting.delete(node.text);
    return type;
  }
  return undefined;
}

/**
 * The literal type of each default of a `defineProps` declaration that is a literal, or a
 * top-level constant of one: `kind = "a"` is `"a"`. The compiler and the editor make a prop with a
 * default optional for the parent only in the members of a union of props whose type admits that
 * literal, so `kind = "a"` does not let the parent omit `kind: "b"` of another member. A default
 * that is not a literal is optional in every member that declares it (`MEEK131` checks that each
 * member that requires the prop admits it).
 *
 * @example
 * propsDefaultLiteralTypes(declaration, file) // Map { "kind" => "\"a\"", "count" => "0" }
 */
export function propsDefaultLiteralTypes(declaration: ts.VariableDeclaration, file: ts.SourceFile): Map<string, string> {
  const names = topLevelNames(file);
  const types = new Map<string, string>();
  for (const [key, value] of propsDefaultExpressions(declaration)) {
    const type = literalTypeText(value, file, names, new Set());
    if (type !== undefined) types.set(key, type);
  }
  return types;
}

/** Each default value of a `defineProps` declaration by prop, the first one of a repeated prop. */
function propsDefaultExpressions(declaration: ts.VariableDeclaration): Map<string, ts.Expression> {
  const texts = new Map<string, ts.Expression>();
  const add = (key: string, value: ts.Expression): void => {
    if (!texts.has(key)) texts.set(key, value);
  };
  const call = definePropsInitializer(declaration);
  const argument = call?.arguments[0];
  if (argument && ts.isObjectLiteralExpression(argument)) {
    for (const property of argument.properties) {
      if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) add(property.name.text, property.initializer);
    }
  }
  if (ts.isObjectBindingPattern(declaration.name)) {
    for (const element of declaration.name.elements) {
      if (element.dotDotDotToken || !element.initializer) continue;
      const property = element.propertyName;
      const key = property ? (ts.isIdentifier(property) || ts.isStringLiteral(property) ? property.text : undefined) : ts.isIdentifier(element.name) ? element.name.text : undefined;
      if (key !== undefined) add(key, element.initializer);
    }
  }
  return texts;
}

/**
 * `ComponentDefaults` of a component module: each default as written, as a string literal type,
 * so the editor can show `size?: "sm" | "md" = "md"` from the module or its declarations.
 */
export function componentDefaultsType(texts: ReadonlyMap<string, string>): string {
  return `{ ${[...texts].map(([key, text]) => `readonly ${JSON.stringify(key)}: ${JSON.stringify(text)}`).join("; ")} }`;
}

/** What a top-level name of the script is, for the defaults of `defineProps`. */
type TopLevelName =
  | { readonly kind: "import" }
  | { readonly kind: "constant"; readonly statement: ts.VariableStatement; readonly initializer: ts.Expression }
  | { readonly kind: "setup"; readonly reason: string };

/** The setup-dependent part of a constant's value, if any: a call, a function, an assignment… */
function setupDependentNode(node: ts.Node): { node: ts.Node; reason: string } | undefined {
  if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) return { node, reason: "su valor llama a una función, que podría depender del setup o tener efectos" };
  if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) return { node, reason: "su valor espera un resultado" };
  if (ts.isFunctionLike(node) || ts.isClassLike(node)) return { node, reason: "su valor es una función o una clase" };
  if (node.kind === ts.SyntaxKind.ThisKeyword) return { node, reason: "su valor usa this" };
  if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return { node, reason: "su valor asigna una variable" };
  if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) return { node, reason: "su valor modifica una variable" };
  if (ts.isDeleteExpression(node)) return { node, reason: "su valor borra una propiedad" };
  if (ts.isTypeNode(node)) return undefined;
  return ts.forEachChild(node, setupDependentNode);
}

/** Name of the macro that initializes a declaration (`defineEmits`), if any. */
function macroName(initializer: ts.Expression | undefined): string | undefined {
  return initializer && ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) && /^define[A-Z]/.test(initializer.expression.text)
    ? initializer.expression.text
    : undefined;
}

/** Top-level names of the script, as the defaults of `defineProps` may read them. */
function topLevelNames(file: ts.SourceFile): Map<string, TopLevelName> {
  const names = new Map<string, TopLevelName>();
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name) names.set(clause.name.text, { kind: "import" });
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) names.set(bindings.name.text, { kind: "import" });
      else if (bindings) for (const element of bindings.elements) names.set(element.name.text, { kind: "import" });
    } else if (ts.isVariableStatement(statement)) {
      const constant = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        const macro = macroName(initializer);
        for (const name of bindingNames(declaration.name)) {
          if (macro === "defineProps") names.set(name, { kind: "setup", reason: "es una prop" });
          else if (macro) names.set(name, { kind: "setup", reason: `lo declara ${macro}, que sólo existe en el setup` });
          else if (!constant) names.set(name, { kind: "setup", reason: "se declara con let o var y puede cambiar en el setup" });
          else if (!ts.isIdentifier(declaration.name) || !initializer) names.set(name, { kind: "setup", reason: "sale de una desestructuración del setup" });
          else names.set(name, { kind: "constant", statement, initializer });
        }
      }
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
      names.set(statement.name.text, { kind: "setup", reason: "es una función del setup" });
    }
  }
  return names;
}

/**
 * Free names of an expression: the value references that no scope inside it declares, with the
 * same lexical analysis as the destructured props (`app/definitions/scope.ts`). A local `const`, a block,
 * a `catch` variable, a parameter or a property or accessor name is not a free name.
 */
function freeNames(root: ts.Node): ts.Identifier[] {
  return rootReferences(root, () => true);
}

/** Function-like nodes that bind their own `arguments`, `new.target` and `super`; an arrow function does not. */
function bindsContext(node: ts.Node): boolean {
  return ts.isFunctionLike(node) && !ts.isArrowFunction(node);
}

/**
 * The first read inside `root` of a binding that the enclosing function gives implicitly
 * (`arguments`, `new.target`, `super`) and that no function inside `root` gives: inside the
 * defaults it would be the one of `__meeko_defaultProps`, not the one of the setup.
 */
function contextBinding(root: ts.Node): { node: ts.Node; name: string } | undefined {
  const local = (node: ts.Node): boolean => {
    for (let current = node.parent; current; current = current.parent) {
      if (bindsContext(current)) return true;
      if (current === root) break;
    }
    return false;
  };
  const visit = (node: ts.Node): { node: ts.Node; name: string } | undefined => {
    if (ts.isTypeNode(node)) return undefined;
    const name = ts.isIdentifier(node) && node.text === "arguments" && isValueReference(node) ? "arguments"
      : ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.NewKeyword ? "new.target"
        : node.kind === ts.SyntaxKind.SuperKeyword ? "super"
          : undefined;
    if (name && !local(node)) return { node, name };
    return ts.forEachChild(node, visit);
  };
  return visit(root);
}

/** Why a default or a constant may not read an implicit binding of the setup function. */
const contextReason = (name: string): string => `${name} es implícito de la función que lo contiene: en el setup es el de la función del componente y en los valores por defecto sería otro`;

/**
 * The constants of the script that the `defineProps` defaults read, in source order, so they can be
 * evaluated with the defaults, before the setup. A default may read an import or a top-level
 * `const` whose value only uses literals, imports and other such constants; a read of anything else
 * of the setup (a prop, a signal, a `let`, a value computed by a call…) is `MEEK123`.
 */
export function propsDefaultsConstants(file: ts.SourceFile, defaults: ReadonlyArray<{ readonly key: string; readonly value: ts.Expression }>): ts.VariableStatement[] {
  const names = topLevelNames(file);
  const needed = new Set<ts.VariableStatement>();
  const visiting = new Set<string>();
  const fail = (key: string, reference: ts.Identifier, reason: string): never => {
    throw new PropsDefaultsError("MEEK123", `El valor por defecto de la prop ${key} usa ${reference.text}, que depende del setup: ${reason}. Los valores por defecto se evalúan antes del setup; usa un literal, un import o una constante de nivel superior cuyo valor sólo use literales, imports y otras constantes así`, reference);
  };
  /** Whether the constant `name` may be read by the defaults; the reason if it may not. */
  const constantReason = (name: string): string | undefined => {
    const entry = names.get(name);
    if (!entry || entry.kind === "import") return undefined;
    if (entry.kind === "setup") return entry.reason;
    if (needed.has(entry.statement) || visiting.has(name)) return undefined;
    visiting.add(name);
    const dependent = setupDependentNode(entry.initializer);
    if (dependent) return dependent.reason;
    const implicit = contextBinding(entry.initializer);
    if (implicit) return `su valor usa ${implicit.name}, y ${contextReason(implicit.name)}`;
    for (const inner of freeNames(entry.initializer)) {
      const reason = constantReason(inner.text);
      if (reason) return `su valor usa ${inner.text}, que ${reason}`;
    }
    needed.add(entry.statement);
    return undefined;
  };
  for (const { key, value } of defaults) {
    const implicit = contextBinding(value);
    if (implicit) throw new PropsDefaultsError("MEEK123", `El valor por defecto de la prop ${key} usa ${implicit.name}, que depende del setup: ${contextReason(implicit.name)}. Los valores por defecto se evalúan antes del setup; usa un literal, un import o una constante de nivel superior cuyo valor sólo use literales, imports y otras constantes así`, implicit.node);
    for (const reference of freeNames(value)) {
      const reason = constantReason(reference.text);
      if (reason) fail(key, reference, reason);
    }
  }
  return file.statements.filter((statement): statement is ts.VariableStatement => ts.isVariableStatement(statement) && needed.has(statement));
}
