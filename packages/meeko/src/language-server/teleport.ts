import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItemKind, InsertTextFormat, MarkupKind } from "vscode-languageserver/node";
import type { CompletionItem, Hover, Position } from "vscode-languageserver/node";
import { tagAt } from "./embedded.js";

const teleportTag = "MeekoTeleport";

/** What `<MeekoTeleport>` admits, besides `if:when` and `each:of`. */
const teleportAttributes = [
  { name: "to", detail: "Destino: \"body\" o \"#id\" de un elemento del documento", insert: 'to="$1"', trigger: true },
  { name: "bind:to", detail: "Destino calculado: una expresión de tipo \"body\" | `#${string}`", insert: 'bind:to="$1"', trigger: false },
  { name: "disabled", detail: "Pinta el contenido en su sitio, sin moverlo", insert: "disabled", trigger: false },
  { name: "bind:disabled", detail: "Mientras es verdadera, el contenido se pinta en su sitio; cambiarla mueve los mismos nodos", insert: 'bind:disabled="$1"', trigger: false },
  { name: "if:when", detail: "Muestra la etiqueta mientras la expresión es verdadera", insert: 'if:when="$1"', trigger: false },
  { name: "each:of", detail: "Repite la etiqueta por cada elemento de la lista", insert: 'each:of="$1"', trigger: false },
] as const;

/** Markdown of the hover on `<MeekoTeleport>`. */
const teleportDocs = [
  "```html",
  "<MeekoTeleport to=\"#toolbar\" bind:disabled=\"…\">…</MeekoTeleport>",
  "```",
  "",
  "Etiqueta propia de Meeko: pinta su contenido en otro lugar del documento (`to=\"body\"` o `to=\"#id\"`) sin sacarlo de este componente, que conserva su ámbito reactivo, sus eventos, sus snippets, `provide`/`inject`, sus manejadores de errores y el CSS `scoped`. El HTML del servidor ya lo trae en su destino.",
  "",
  "Con `disabled` (o `bind:disabled`) se pinta en su sitio. Para modales y menús, `<dialog>` y `popover` ya van en la capa superior del navegador.",
].join("\n");

/** `id="…"` of the elements of a `.meeko` template: the ids a teleport can name without escaping. */
function templateIds(source: string): string[] {
  return [...source.matchAll(/\sid=(["'])([A-Za-z][A-Za-z0-9_-]*)\1/g)].map((match) => match[2]!);
}

/** `app/app.meeko` and the layouts of `app/layouts`, whose elements a page's teleport usually targets. */
function shellFiles(root: string): string[] {
  const app = join(root, "app");
  const files = [join(app, "app.meeko")];
  try {
    for (const entry of readdirSync(join(app, "layouts"), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".meeko")) files.push(join(app, "layouts", entry.name));
    }
  } catch { /* A project without layouts. */ }
  return files;
}

/**
 * Completado de `<MeekoTeleport>`: sus atributos y, dentro de `to="…"`, `body` y los `#id` del
 * documento abierto, de `app/app.meeko` y de los layouts de `app/layouts` cuando se pasa `root`.
 * `undefined` fuera de esa etiqueta o si un componente del proyecto se llama `MeekoTeleport`.
 */
export function teleportCompletion(document: TextDocument, position: Position, shadowed: ReadonlySet<string> = new Set(), root?: string): CompletionItem[] | undefined {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const context = tagAt(source, offset);
  if (context?.tag !== teleportTag || shadowed.has(teleportTag)) return undefined;
  if (context.value) {
    if (context.value.attribute !== "to") return undefined;
    const range = { start: document.positionAt(context.value.start), end: position };
    const seen = new Set<string>();
    const items: CompletionItem[] = [{ label: "body", kind: CompletionItemKind.Value, detail: "Al final de <body>", sortText: "0", textEdit: { range, newText: "body" } }];
    const add = (ids: readonly string[], detail: string): void => {
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        items.push({ label: `#${id}`, kind: CompletionItemKind.Reference, detail, sortText: `1${id}`, textEdit: { range, newText: `#${id}` } });
      }
    };
    add(templateIds(source), "Este componente");
    if (root) {
      for (const file of shellFiles(root)) {
        let text: string;
        try { text = readFileSync(file, "utf8"); }
        catch { continue; }
        add(templateIds(text), relative(root, file).replaceAll("\\", "/"));
      }
    }
    return items;
  }
  const word = /[\w:.-]*$/.exec(source.slice(context.tagStart, offset))![0];
  if (!/\s/.test(source[offset - word.length - 1] ?? "")) return undefined;
  const present = new Set([...source.slice(context.tagStart, context.tagEnd).matchAll(/\s([^\s=/>"']+)/g)].map((match) => match[1]!));
  present.delete(word);
  const has = (name: string): boolean => present.has(name) || present.has(name.startsWith("bind:") ? name.slice(5) : `bind:${name}`);
  const range = { start: document.positionAt(offset - word.length), end: position };
  return teleportAttributes.filter((attribute) => !has(attribute.name)).map((attribute, index): CompletionItem => ({
    label: attribute.name,
    kind: attribute.name.includes(":") && !attribute.name.startsWith("bind:") ? CompletionItemKind.Keyword : CompletionItemKind.Property,
    detail: attribute.detail,
    sortText: `0${index}`,
    insertTextFormat: InsertTextFormat.Snippet,
    textEdit: { range, newText: attribute.insert },
    ...(attribute.trigger ? { command: { title: "Destinos", command: "editor.action.triggerSuggest" } } : {}),
  }));
}

/** Hover de la etiqueta `<MeekoTeleport>` (apertura o cierre), salvo si es un componente del proyecto. */
export function teleportHover(document: TextDocument, position: Position, shadowed: ReadonlySet<string> = new Set()): Hover | undefined {
  if (shadowed.has(teleportTag)) return undefined;
  const source = document.getText();
  const offset = document.offsetAt(position);
  const before = source.lastIndexOf("<", offset);
  if (before < 0) return undefined;
  const name = /^<\/?(MeekoTeleport)(?![\w$.-])/.exec(source.slice(before, before + teleportTag.length + 2));
  if (!name) return undefined;
  const start = before + name[0].length - teleportTag.length;
  if (offset < start || offset > start + teleportTag.length) return undefined;
  if (!tagAt(source, start + 1) && !/^<\//.test(name[0])) return undefined;
  return {
    contents: { kind: MarkupKind.Markdown, value: teleportDocs },
    range: { start: document.positionAt(start), end: document.positionAt(start + teleportTag.length) },
  };
}
