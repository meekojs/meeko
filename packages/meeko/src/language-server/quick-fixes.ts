import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { CodeActionKind } from "vscode-languageserver/node";
import type { CodeAction, Diagnostic } from "vscode-languageserver/node";
import { parseSfc } from "../compiler/sfc.js";
import type { SfcSection } from "../compiler/sfc.js";
import type { EditCapabilities } from "./actions.js";
import { tagAt } from "./embedded.js";
import { usageEdits } from "./features.js";
import type { FeatureContext } from "./features.js";
import { nodeAt } from "./reactivity.js";

/** The top-level statement of the script that contains `node`. */
function topStatement(node: ts.Node): ts.Statement | undefined {
  let current: ts.Node = node;
  while (current.parent && !ts.isSourceFile(current.parent)) current = current.parent;
  return current.parent && ts.isSourceFile(current.parent) ? current as ts.Statement : undefined;
}

/**
 * Quick fixes of MEEK101, a prop read once by the setup: turn the copy into a `computed`, so it
 * follows the prop (its uses gain `.value`, also in the template), or state that only the first
 * value matters with `untrack(() => props.x)`.
 */
export function propsReadActions(context: FeatureContext, diagnostics: readonly Diagnostic[]): CodeAction[] {
  const { document } = context;
  const source = document.getText();
  let script: SfcSection;
  try { script = parseSfc(source, context.component.filename).script; }
  catch { return []; }
  const file = ts.createSourceFile(context.component.filename, script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const at = (local: number) => document.positionAt(script.contentStart + local);
  const actions: CodeAction[] = [];
  const handled = new Set<number>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== "MEEK101") continue;
    const offset = document.offsetAt(diagnostic.range.start);
    if (handled.has(offset)) continue;
    handled.add(offset);
    const node = nodeAt(file, offset - script.contentStart);
    if (!node || !ts.isIdentifier(node)) continue;
    const statement = topStatement(node);
    const declaration = statement && ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
      && statement.declarationList.declarations.length === 1 ? statement.declarationList.declarations[0]! : undefined;
    const initializer = declaration?.initializer;
    if (declaration && initializer && ts.isIdentifier(declaration.name) && node.getStart(file) >= initializer.getStart(file) && node.end <= initializer.end) {
      const name = declaration.name.text;
      const uses = usageEdits(context, at(declaration.name.getStart(file)), (used) => `${used}.value`);
      if (uses) {
        actions.push({
          title: `Convertir ${name} en computed para que siga a la prop`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: { changes: { [document.uri]: [
            { range: { start: at(initializer.getStart(file)), end: at(initializer.end) }, newText: `computed(() => ${initializer.getText(file)})` },
            ...uses,
          ] } },
        });
      }
    }
    // `const { label, title: heading } = props`: one computed per name.
    const pattern = declaration && ts.isObjectBindingPattern(declaration.name) && initializer === node ? declaration.name : undefined;
    if (statement && pattern && pattern.elements.every((element) => !element.dotDotDotToken && !element.initializer && ts.isIdentifier(element.name)
      && (!element.propertyName || ts.isIdentifier(element.propertyName)))) {
      const indent = /[ \t]*$/.exec(source.slice(0, script.contentStart + statement.getStart(file)))![0];
      const newline = source.includes("\r\n") ? "\r\n" : "\n";
      const lines = pattern.elements.map((element) => {
        const local = (element.name as ts.Identifier).text;
        const property = element.propertyName ? (element.propertyName as ts.Identifier).text : local;
        return `const ${local} = computed(() => ${node.text}.${property});`;
      });
      const uses = pattern.elements.flatMap((element) => usageEdits(context, at(element.name.getStart(file)), (used) => `${used}.value`) ?? []);
      actions.push({
        title: `Convertir la desestructuración de ${node.text} en computed`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        isPreferred: true,
        edit: { changes: { [document.uri]: [
          { range: { start: at(statement.getStart(file)), end: at(statement.end) }, newText: lines.join(`${newline}${indent}`) },
          ...uses,
        ] } },
      });
    }
    // A read in the setup (not in onMounted, not a destructuring): only the first value matters.
    const parent = node.parent;
    const access = parent && (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node ? parent : undefined;
    if (access && /el setup se ejecuta/.test(String(diagnostic.message))) {
      const text = access.getText(file);
      actions.push({
        title: `Leer ${text} sólo una vez con untrack`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: { changes: { [document.uri]: [{ range: { start: at(access.getStart(file)), end: at(access.end) }, newText: `untrack(() => ${text})` }] } },
      });
    }
  }
  return actions;
}

/** The item name of a list: `variant` for `variants.value`, `entry` for `entries`, else `item`. */
export function itemName(list: string): string {
  const name = /([A-Za-z_$][\w$]*)(?:\.value)?\s*$/.exec(list)?.[1];
  if (!name) return "item";
  const singular = name.endsWith("ies") ? `${name.slice(0, -3)}y` : name.endsWith("s") && !name.endsWith("ss") ? name.slice(0, -1) : "";
  return singular && /^[A-Za-z_$][\w$]*$/.test(singular) ? singular : "item";
}

/**
 * MEEK022 on a list without `each:as`: names its item. Works on the text, because a component with
 * that error does not compile.
 */
export function listItemActions(document: TextDocument, diagnostics: readonly Diagnostic[]): CodeAction[] {
  const source = document.getText();
  const actions: CodeAction[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== "MEEK022") continue;
    // The diagnostic starts at the `<` of the tag; tagAt reads the tag from after its name.
    const start = document.offsetAt(diagnostic.range.start);
    const context = tagAt(source, start + (/^<[A-Za-z][\w$.-]*/.exec(source.slice(start))?.[0].length ?? 1));
    if (!context) continue;
    const tag = source.slice(context.tagStart, context.tagEnd);
    if (/\seach:as\s*=/.test(tag)) continue;
    const list = /\seach:of\s*=\s*("([^"]*)"|'([^']*)')/.exec(tag);
    if (!list) continue;
    const item = itemName(list[2] ?? list[3] ?? "");
    const at = document.positionAt(context.tagStart + list.index + list[0].length);
    actions.push({
      title: `Añadir each:as="${item}"`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      isPreferred: true,
      edit: { changes: { [document.uri]: [{ range: { start: at, end: at }, newText: ` each:as="${item}"` }] } },
    });
  }
  return actions;
}

/**
 * `<AppNuevo />` without a component: creates `app/components/App/Nuevo.meeko` (inside the longest
 * folder of `app/components` that the name starts with, as autoimports name components) with one
 * prop per `bind:` of the tag, typed like the value the tag passes.
 */
export function createComponentActions(context: FeatureContext, diagnostics: readonly Diagnostic[], capabilities: EditCapabilities): CodeAction[] {
  if (!capabilities.createFiles) return [];
  const { document, component } = context;
  const source = document.getText();
  const actions: CodeAction[] = [];
  const created = new Set<string>();
  for (const diagnostic of diagnostics) {
    const name = diagnostic.code === "TS2304" ? /Cannot find name '([A-Z][A-Za-z0-9]*)'/.exec(String(diagnostic.message))?.[1] : undefined;
    const offset = document.offsetAt(diagnostic.range.start);
    if (!name || source[offset - 1] !== "<" || created.has(name)) continue;
    const root = context.project.sourceRoots().filter((entry) => component.filename.startsWith(entry)).sort((a, b) => b.length - a.length)[0];
    if (!root) continue;
    const words = name.match(/[A-Z][a-z0-9]*/g) ?? [name];
    let directory = join(root, "app", "components");
    let used = 0;
    while (used < words.length - 1 && existsSync(join(directory, words[used]!))) directory = join(directory, words[used++]!);
    const target = join(directory, `${words.slice(used).join("")}.meeko`);
    if (existsSync(target)) continue;
    created.add(name);
    const tag = tagAt(source, offset + name.length);
    const props = tag ? [...source.slice(tag.tagStart, tag.tagEnd).matchAll(/\sbind:([A-Za-z_$][\w$]*)\s*=\s*"/g)].map((match) => ({
      name: match[1]!,
      type: boundType(context, tag.tagStart + match.index + match[0].length) ?? "unknown",
    })) : [];
    const indent = /^\t/m.test(source) ? "\t" : "  ";
    const script = props.length
      ? `<script lang="ts">\nexport interface Props {\n${props.map((prop) => `${indent}${prop.name}: ${prop.type};`).join("\n")}\n}\n\nconst props = defineProps<Props>();\n</script>\n\n`
      : "";
    const content = `${script}<template>\n${indent}<div></div>\n</template>\n`;
    const uri = pathToFileURL(target).href;
    actions.push({
      title: `Crear el componente ${name} en ${relative(root, target).replaceAll("\\", "/")}`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit: { documentChanges: [
        { kind: "create", uri, options: { ignoreIfExists: true } },
        { textDocument: { uri, version: null }, edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: content }] },
      ] },
    });
  }
  return actions;
}

/** The type of the expression in a `bind:` value that starts at `valueStart`, widened (`"x"` → `string`). */
function boundType(context: FeatureContext, valueStart: number): string | undefined {
  const program = context.project.service.getProgram();
  const file = program?.getSourceFile(context.component.virtualFilename);
  const generated = context.component.toGenerated(valueStart);
  if (!program || !file || generated === undefined) return undefined;
  let node = nodeAt(file, generated);
  // The whole expression: climb while the parent starts at the same place.
  while (node?.parent && ts.isExpression(node.parent) && node.parent.getStart(file) === node.getStart(file)) node = node.parent;
  if (!node) return undefined;
  const checker = program.getTypeChecker();
  const type = checker.getBaseTypeOfLiteralType(checker.getTypeAtLocation(node));
  if (type.flags & ts.TypeFlags.Any) return undefined;
  return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
}
