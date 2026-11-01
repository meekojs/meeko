import ts from "@typescript/typescript6";

import type { SourceMapping } from "../mapping";

import { isWriteTarget, rootReferences } from "../../app/definitions/scope";
import { originalOffset } from "../mapping";

/** A write of a destructured prop (`label = "x"`), at its offset in the `.meeko` source. */
export class PropAliasWriteError extends Error {
  constructor(readonly binding: string, readonly key: string, readonly offset: number | undefined) {
    super(`${binding} es la prop ${key} de defineProps y es de sólo lectura: no se puede asignar ni borrar con delete. Para cambiar un valor del padre, emite un evento (defineEmits) o usa un modelo (defineModel); para un valor propio que empieza con la prop, usa signal(${binding})`);
  }
}

/** The functions of a compiled component whose code sees the setup bindings. */
const bindingScopes = new Set(["__setup", "renderWithState", "renderToString", "hydrateScope"]);

const identifierKey = (key: string): boolean => /^[A-Za-z_$][\w$]*$/.test(key);

/** The code that reads `key` of `object`: `props.label`, or `props["aria-label"]`. */
function propertyRead(object: string, key: string): { text: string; keyStart: number } {
  if (identifierKey(key)) return { text: `${object}.${key}`, keyStart: object.length + 1 };
  return { text: `${object}[${JSON.stringify(key)}]`, keyStart: object.length + 1 };
}

/**
 * A type query of a destructured prop, `typeof label` or `typeof label.length`, whose key is not
 * an identifier: a qualified name cannot follow `props["aria-label"]`, so the query becomes an
 * indexed access of the props' type, `(typeof props)["aria-label"]["length"]`.
 */
function indexedTypeQuery(reference: ts.Identifier, object: string, key: string, file: ts.SourceFile): Omit<Replacement, "original"> | undefined {
  if (identifierKey(key)) return undefined;
  let name: ts.Node = reference;
  const members: string[] = [];
  while (ts.isQualifiedName(name.parent) && name.parent.left === name) {
    members.push(name.parent.right.text);
    name = name.parent;
  }
  const query = name.parent;
  if (!ts.isTypeQueryNode(query) || members.length === 0 || query.typeArguments) return undefined;
  const prefix = `(typeof ${object})[`;
  const text = `${prefix}${JSON.stringify(key)}]${members.map((member) => `[${JSON.stringify(member)}]`).join("")}`;
  return { start: query.getStart(file), end: name.getEnd(), text, pieces: [{ start: 0, end: text.length }, { start: prefix.length, end: prefix.length + key.length + 2 }] };
}

interface Replacement {
  start: number;
  end: number;
  text: string;
  /** Original offset of the name it replaces, if known. */
  original: number | undefined;
  /** Original length of that name, when the replacement spans more than the name. */
  originalLength?: number;
  /** Spans inside `text` that map to the original name. */
  pieces: ReadonlyArray<{ start: number; end: number }>;
}

/**
 * Reads of a destructured `defineProps` (`const { label, class: className } = defineProps<Props>()`)
 * become reads of the props view, `__meeko_props.label`, so they follow the parent's props in the
 * script, the template, `computed`, `effect` and handlers alike. It works on the generated module,
 * where every render path and every check copy of the template is already code: a name that a
 * parameter, a list item, a snippet parameter or a local declaration shadows stays as it is.
 * Writes are rejected (`PropAliasWriteError`). The source mappings follow the edits, and the
 * prop name of each read maps to the destructured name, so hover and errors land on it.
 */
export function rewritePropAliases(code: string, mappings: readonly SourceMapping[], aliases: ReadonlyMap<string, string>, object: string): { code: string; mappings: SourceMapping[] } {
  if (aliases.size === 0) return { code, mappings: [...mappings] };
  const file = ts.createSourceFile("component.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const verbatimOriginal = (start: number, end: number): number | undefined => {
    let best: SourceMapping | undefined;
    for (const mapping of mappings) {
      if (mapping.generatedStart > start || mapping.generatedEnd < end) continue;
      if (mapping.generatedEnd - mapping.generatedStart !== mapping.originalLength) continue;
      if (!best || mapping.generatedEnd - mapping.generatedStart < best.generatedEnd - best.generatedStart) best = mapping;
    }
    return best ? best.originalStart + start - best.generatedStart : originalOffset(mappings, start);
  };
  const replacements: Replacement[] = [];
  for (const statement of file.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !bindingScopes.has(statement.name.text)) continue;
    // `typeof label` in a type names the prop too: the destructured name no longer exists.
    for (const reference of rootReferences(statement, (name) => aliases.has(name), true)) {
      const key = aliases.get(reference.text)!;
      const start = reference.getStart(file);
      const end = reference.getEnd();
      const original = verbatimOriginal(start, end);
      if (isWriteTarget(reference)) throw new PropAliasWriteError(reference.text, key, original);
      const indexed = indexedTypeQuery(reference, object, key, file);
      if (indexed) {
        replacements.push({ ...indexed, original, originalLength: end - start });
        continue;
      }
      const read = propertyRead(object, key);
      const shorthand = ts.isShorthandPropertyAssignment(reference.parent) && reference.parent.name === reference;
      const prefix = shorthand ? `${reference.text}: ` : "";
      const text = prefix + read.text;
      const pieces = [{ start: 0, end: text.length }, { start: prefix.length + read.keyStart, end: prefix.length + read.keyStart + key.length + (read.text.endsWith("]") ? 2 : 0) }];
      if (shorthand) pieces.push({ start: 0, end: reference.text.length });
      replacements.push({ start, end, text, original, pieces });
    }
  }
  if (replacements.length === 0) return { code, mappings: [...mappings] };
  replacements.sort((left, right) => left.start - right.start);
  // Shift of a boundary: a start moves with the edits that end before it, an end with those that start before it.
  const shiftStart = (position: number): number => {
    let shifted = position;
    for (const replacement of replacements) if (replacement.end <= position) shifted += replacement.text.length - (replacement.end - replacement.start);
    return shifted;
  };
  const shiftEnd = (position: number): number => {
    let shifted = position;
    for (const replacement of replacements) if (replacement.start < position) shifted += replacement.text.length - (replacement.end - replacement.start);
    return shifted;
  };
  const result: SourceMapping[] = [];
  for (const mapping of mappings) {
    const inside = replacements.filter((replacement) => replacement.start >= mapping.generatedStart && replacement.end <= mapping.generatedEnd);
    result.push({ ...mapping, generatedStart: shiftStart(mapping.generatedStart), generatedEnd: shiftEnd(mapping.generatedEnd) });
    // A verbatim span keeps exact positions in the pieces between its edits.
    if (inside.length === 0 || mapping.generatedEnd - mapping.generatedStart !== mapping.originalLength) continue;
    let cursor = mapping.generatedStart;
    for (const replacement of [...inside, undefined]) {
      const pieceEnd = replacement ? replacement.start : mapping.generatedEnd;
      if (pieceEnd > cursor) {
        result.push({ generatedStart: shiftStart(cursor), generatedEnd: shiftEnd(pieceEnd), originalStart: mapping.originalStart + cursor - mapping.generatedStart, originalLength: pieceEnd - cursor });
      }
      if (replacement) cursor = replacement.end;
    }
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const replacement of replacements) {
    parts.push(code.slice(cursor, replacement.start), replacement.text);
    cursor = replacement.end;
    if (replacement.original === undefined) continue;
    const at = shiftStart(replacement.start);
    for (const piece of replacement.pieces) {
      result.push({ generatedStart: at + piece.start, generatedEnd: at + piece.end, originalStart: replacement.original, originalLength: replacement.originalLength ?? replacement.end - replacement.start });
    }
  }
  parts.push(code.slice(cursor));
  return { code: parts.join(""), mappings: result.sort((left, right) => left.generatedStart - right.generatedStart) };
}
