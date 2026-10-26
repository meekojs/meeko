import ts from "@typescript/typescript6";
import type { SfcSection } from "./sfc.js";

/**
 * `generic="T extends { id: string }"` en el `<script lang="ts">` de un componente: sus parámetros
 * de tipo, con la sintaxis de una lista de parámetros de tipo de TypeScript.
 */
export interface GenericParameters {
  /** La lista tal como se escribe, para declarar los parámetros: `T extends { id: string }, K = string`. */
  readonly declaration: string;
  /** Posición de la lista en el `.meeko`. */
  readonly offset: number;
  /** Nombres de los parámetros, en orden, para pasarlos: `T, K`. */
  readonly names: readonly string[];
  /** Cada parámetro con las posiciones de su nombre y su restricción, para el editor. */
  readonly parameters: ReadonlyArray<{ readonly name: string; readonly nameOffset: number; readonly constraint?: { readonly text: string; readonly offset: number } }>;
}

/** Atributo `generic` no válido (MEEK100), en una posición del `.meeko`. */
export class GenericError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.name = "GenericError";
    this.offset = offset;
  }
}

/** Valor del atributo `name` en la etiqueta de apertura de una sección, con la posición del valor y del atributo. */
export function sectionAttribute(source: string, section: Pick<SfcSection, "start" | "contentStart" | "attributes">, name: string): { value: string; offset: number; start: number } | undefined {
  const attribute = section.attributes.find((candidate) => candidate.name === name);
  if (!attribute) return undefined;
  const tag = source.slice(section.start, section.contentStart);
  const pattern = /\s([^\s"'=<>/`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of tag.matchAll(pattern)) {
    if (match[1]!.toLowerCase() !== name) continue;
    const start = section.start + match.index + 1;
    const raw = match[2] ?? match[3] ?? match[4];
    if (raw === undefined) return { value: attribute.value, offset: start, start };
    const quoted = match[2] !== undefined || match[3] !== undefined;
    const offset = section.start + match.index + match[0].length - raw.length - (quoted ? 1 : 0);
    return { value: attribute.value, offset, start };
  }
  return { value: attribute.value, offset: section.start, start: section.start };
}

/** Valida con el parser de TypeScript la lista de parámetros de tipo de `generic`. */
export function parseGeneric(text: string, offset: number): GenericParameters {
  if (!text.trim()) throw new GenericError("generic necesita al menos un parámetro de tipo, como generic=\"T\" o generic=\"T extends { id: string }\"", offset);
  const prefix = "type __MeekoGeneric<";
  const suffix = "> = never;";
  const code = `${prefix}${text}${suffix}`;
  const file = ts.createSourceFile("generic.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] };
  const at = (position: number): number => offset + Math.max(0, Math.min(text.length, position - prefix.length));
  const error = file.parseDiagnostics[0];
  if (error) throw new GenericError(`Lista de parámetros de tipo de generic no válida: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`, at(error.start ?? prefix.length));
  const statement = file.statements[0];
  // The list must be the whole value: `T> = string; type X<U` would close it early.
  if (file.statements.length !== 1 || !statement || !ts.isTypeAliasDeclaration(statement) || !statement.typeParameters?.length
    || statement.type.getStart(file) !== prefix.length + text.length + suffix.indexOf("never")) {
    throw new GenericError("generic debe ser sólo una lista de parámetros de tipo, como generic=\"T, K extends keyof T\"", offset);
  }
  const names: string[] = [];
  const parameters: Array<GenericParameters["parameters"][number]> = [];
  for (const parameter of statement.typeParameters) {
    const modifier = parameter.modifiers?.[0];
    if (modifier) throw new GenericError(`generic no admite el modificador ${modifier.getText(file)}; escribe sólo el nombre, la restricción y el valor por defecto`, at(modifier.getStart(file)));
    const name = parameter.name.text;
    if (name.startsWith("__")) throw new GenericError(`El parámetro de tipo ${name} no puede empezar por __, que Meeko reserva para el código generado`, at(parameter.name.getStart(file)));
    if (names.includes(name)) throw new GenericError(`El parámetro de tipo ${name} está repetido en generic`, at(parameter.name.getStart(file)));
    names.push(name);
    const constraint = parameter.constraint;
    parameters.push({ name, nameOffset: at(parameter.name.getStart(file)), ...(constraint ? { constraint: { text: constraint.getText(file), offset: at(constraint.getStart(file)) } } : {}) });
  }
  return { declaration: text, offset, names, parameters };
}

/**
 * Primera referencia a un parámetro de `generic` en una declaración de tipo del script, que el
 * compilador lleva al nivel de módulo, donde esos parámetros no existen. No cuenta un nombre que la
 * propia declaración declara como parámetro de tipo (`type Row<T> = ...`).
 */
export function genericReference(statement: ts.Statement, names: ReadonlySet<string>): ts.Identifier | undefined {
  const inferred = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isInferTypeNode(node)) inferred.add(node.typeParameter.name.text);
    ts.forEachChild(node, collect);
  };
  collect(statement);
  const declares = (node: ts.Node, name: string): boolean => {
    const parameters = (node as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters;
    if (parameters?.some((parameter) => parameter.name.text === name)) return true;
    return ts.isMappedTypeNode(node) && node.typeParameter.name.text === name;
  };
  const shadowed = (node: ts.Node, name: string): boolean => {
    if (inferred.has(name)) return true;
    for (let current: ts.Node | undefined = node; current; current = current.parent) {
      if (declares(current, name)) return true;
      if (current === statement) break;
    }
    return false;
  };
  let found: ts.Identifier | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const identifier = ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) ? node.typeName
      : ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression) ? node.expression
        : undefined;
    if (identifier && names.has(identifier.text) && !shadowed(node, identifier.text)) {
      found = identifier;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
}
