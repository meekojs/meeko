import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CodeActionRequest, CompletionRequest, CompletionResolveRequest, createConnection, createProtocolConnection, DefinitionRequest,
  DidChangeTextDocumentNotification, DidChangeWatchedFilesNotification, DidOpenTextDocumentNotification, DidSaveTextDocumentNotification,
  DocumentFormattingRequest, DocumentSymbolRequest, ExitNotification, FileChangeType, FoldingRangeRequest, HoverRequest,
  InitializedNotification, InitializeRequest, PrepareRenameRequest, PublishDiagnosticsNotification, ReferencesRequest,
  RegistrationRequest, RenameRequest, SemanticTokensRefreshRequest, SemanticTokensRequest, ShutdownRequest, SignatureHelpRequest,
  StreamMessageReader, StreamMessageWriter,
} from "vscode-languageserver/node";
import type {
  CodeAction, CompletionItem, Diagnostic, DocumentSymbol, InitializeResult, Location, MarkupContent, ProtocolConnection, TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver/node";
import { checkSource } from "../src/check.ts";
import { startLanguageServer } from "../src/language-server/server.ts";
import type { LanguageServerInitializationOptions } from "../src/language-server/server.ts";

/** Cliente LSP mínimo que registra diagnósticos y documentos abiertos. */
class Client {
  readonly diagnostics = new Map<string, Diagnostic[]>();
  readonly documents = new Map<string, TextDocument>();
  registrations = 0;
  result: InitializeResult | undefined;
  private waiters: Array<() => void> = [];

  constructor(readonly connection: ProtocolConnection, private readonly onDispose: () => void = () => undefined) {
    connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
      this.diagnostics.set(params.uri, params.diagnostics);
      for (const waiter of this.waiters.splice(0)) waiter();
    });
    connection.onRequest(RegistrationRequest.type, () => { this.registrations++; });
    connection.onRequest(SemanticTokensRefreshRequest.type, () => undefined);
    connection.onNotification("window/logMessage", () => undefined);
    connection.listen();
  }

  async initialize(root: string, initializationOptions: LanguageServerInitializationOptions = {}): Promise<InitializeResult> {
    const result = await this.connection.sendRequest(InitializeRequest.type, {
      processId: null,
      rootUri: pathToFileURL(root).href,
      workspaceFolders: [{ uri: pathToFileURL(root).href, name: "fixture" }],
      capabilities: {
        workspace: { didChangeWatchedFiles: { dynamicRegistration: true }, semanticTokens: { refreshSupport: true } },
        textDocument: { rename: { prepareSupport: true } },
      },
      initializationOptions: { diagnosticsDelay: 0, ...initializationOptions },
    });
    await this.connection.sendNotification(InitializedNotification.type, {});
    this.result = result;
    return result;
  }

  async open(file: string, text?: string): Promise<string> {
    const uri = pathToFileURL(file).href;
    const content = text ?? await readFile(file, "utf8");
    this.documents.set(uri, TextDocument.create(uri, "meeko", 1, content));
    await this.connection.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "meeko", version: 1, text: content } });
    return uri;
  }

  async change(uri: string, text: string): Promise<void> {
    const previous = this.documents.get(uri)!;
    const version = previous.version + 1;
    this.documents.set(uri, TextDocument.create(uri, "meeko", version, text));
    await this.connection.sendNotification(DidChangeTextDocumentNotification.type, { textDocument: { uri, version }, contentChanges: [{ text }] });
  }

  document(uri: string): TextDocument {
    return this.documents.get(uri)!;
  }

  position(uri: string, needle: string, delta = 0, from?: string): { line: number; character: number } {
    const text = this.document(uri).getText();
    const start = from === undefined ? 0 : text.indexOf(from);
    const offset = text.indexOf(needle, start);
    assert.ok(offset >= 0, `Missing ${needle}`);
    return this.document(uri).positionAt(offset + delta);
  }

  async waitForDiagnostics(uri: string, predicate: (diagnostics: Diagnostic[]) => boolean, timeout = 90_000): Promise<Diagnostic[]> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const current = this.diagnostics.get(uri);
      if (current && predicate(current)) return current;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Diagnostics for ${uri} did not arrive: ${JSON.stringify(current)}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(remaining, 500));
        this.waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
  }

  async close(): Promise<void> {
    await this.connection.sendRequest(ShutdownRequest.type);
    this.onDispose();
    this.connection.dispose();
  }
}

async function inProcess(root: string, options: LanguageServerInitializationOptions = {}): Promise<Client> {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient));
  startLanguageServer(server);
  server.listen();
  const client = new Client(createProtocolConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer)), () => server.dispose());
  await client.initialize(root, options);
  return client;
}

function applyEdits(text: string, edits: readonly TextEdit[]): string {
  const document = TextDocument.create("file:///edit", "meeko", 1, text);
  return TextDocument.applyEdits(document, [...edits]);
}

async function project(prefix: string, files: Record<string, string>, linkPackage = true): Promise<string> {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko", prefix));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  if (linkPackage) {
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
  }
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
  return root;
}

const componentA = `<script lang="ts">
import { greet } from "./lib/greet.js";
const count = signal(0);
const message = greet("Ada");
</script>
<template>
  <section class="a" bind:title="
    message
  ">
    <p>{greet("Bob")}</p>
    <button on:click="() => count.value++">{count.value}</button>
  </section>
</template>
<style>
.a {
  color: red;
}
</style>
`;

const badComponent = `<script lang="ts">
const bad: number = "invalid";
const count = 1;
</script>
<template><p>{count.missing}</p></template>
`;

describe("Meeko language server", () => {
  let root: string;
  let client: Client;
  const file = (name: string) => join(root, name);

  before(async () => {
    root = await project("lsp-", {
      "tsconfig.json": `${JSON.stringify({
        compilerOptions: {
          target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", lib: ["ES2022", "DOM"], types: [], strict: true,
          noEmit: true, skipLibCheck: true, allowArbitraryExtensions: true, rootDirs: [".", ".meeko/types"],
          paths: { "@lib/*": ["./lib/*"] },
        },
        include: ["lib/**/*.ts"],
      })}\n`,
      "lib/greet.ts": '/** Greets someone. */\nexport function greet(name: string, punctuation = "!"): string { return `Hello ${name}${punctuation}`; }\n',
      "A.meeko": componentA,
      "B.meeko": '<script lang="ts">\nimport { greet } from "./lib/greet.js";\nconst text = greet("Eve");\n</script>\n<template><p>{text}</p></template>\n',
      "Bad.meeko": badComponent,
      "Paths.meeko": '<script lang="ts">\nimport { greet } from "@lib/greet.js";\nconst text = greet("Paths");\n</script>\n<template><p>{text}</p></template>\n',
      "lib/answer.ts": "export const answer = 42;\n",
      "PathsTyped.meeko": '<script lang="ts">\nimport { answer } from "@lib/answer.js";\nconst text: string = answer;\n</script>\n<template><p>{text}</p></template>\n',
      "Missing.meeko": '<script lang="ts">\nconst text = greet("x");\n</script>\n<template><p>{text}</p></template>\n',
      "Href.meeko": `<script lang="ts">
import type { RouteRecord } from "@meekojs/meeko/framework";
declare const routes: readonly RouteRecord[];
const about = href(routes, "/about", { params: { id: "1" } });
const tab = href(routes, "/about", { params: { id: "1" }, search: { tab: "a" } });
const user = href(routes, "/users/[id]", { params: { id: "1" } });
</script>
<template><a bind:href="about">{tab}{user}</a></template>
`,
      "Ambiguous.meeko": '<script lang="ts">\nconst value = useCount();\n</script>\n<template><p>{value}</p></template>\n',
      "app/composables/count.ts": "export function useCount(): number { return 1; }\n",
      "shared/utils/count.ts": "export function useCount(): number { return 2; }\n",
    });
    client = await inProcess(root);
  });

  after(async () => {
    await client?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("announces every capability and registers file watchers", async () => {
    const other = await inProcess(root);
    try {
      const result = other.result!;
      const capabilities = result.capabilities;
      assert.equal(result.serverInfo?.name, "meeko-language-server");
      for (const key of [
        "completionProvider", "hoverProvider", "definitionProvider", "referencesProvider", "renameProvider", "signatureHelpProvider",
        "documentSymbolProvider", "foldingRangeProvider", "documentFormattingProvider", "codeActionProvider", "semanticTokensProvider",
      ] as const) assert.ok(capabilities[key], key);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(other.registrations > 0, "the server registers file watchers dynamically");
    } finally { await other.close(); }
  });

  test("publishes full-range diagnostics that match meeko check", async () => {
    const uri = await client.open(file("Bad.meeko"));
    const diagnostics = await client.waitForDiagnostics(uri, (items) => items.length >= 2);
    const document = client.document(uri);
    const cli = await checkSource(badComponent, file("Bad.meeko"));
    assert.deepEqual(
      diagnostics.map((item) => `${item.code}:${document.offsetAt(item.range.start)}`).sort(),
      [...new Set(cli.map((item) => `${item.code}:${item.location.offset}`))].sort(),
    );
    const assignment = diagnostics.find((item) => item.code === "TS2322")!;
    assert.equal(document.getText(assignment.range), "bad");
    const missing = diagnostics.find((item) => item.code === "TS2339")!;
    assert.equal(document.getText(missing.range), "missing");
    assert.ok(diagnostics.every((item) => item.source === "Meeko"));

    await client.change(uri, badComponent.replace('"invalid"', "0").replace("count.missing", "count"));
    await client.waitForDiagnostics(uri, (items) => items.length === 0);
  });

  test("hover, completion, definition and signature help cross script and template", async () => {
    const uri = await client.open(file("A.meeko"));
    const usage = client.position(uri, "count.value", 2, "<template>");
    const hover = await client.connection.sendRequest(HoverRequest.type, { textDocument: { uri }, position: usage });
    assert.match((hover?.contents as MarkupContent).value, /const count: Signal<number>/);

    const completions = await client.connection.sendRequest(CompletionRequest.type, { textDocument: { uri }, position: client.position(uri, "count.value", "count.".length, "<template>") });
    const items = Array.isArray(completions) ? completions : completions?.items ?? [];
    const value = items.find((item) => item.label === "value");
    assert.ok(value, "signal completion");
    const resolved = await client.connection.sendRequest(CompletionResolveRequest.type, value) as CompletionItem;
    assert.match(resolved.detail ?? "", /value/);

    const definitions = await client.connection.sendRequest(DefinitionRequest.type, { textDocument: { uri }, position: usage }) as Location[];
    const declaration = client.document(uri).getText().indexOf("const count") + "const ".length;
    assert.ok(definitions.some((item) => item.uri === uri && client.document(uri).offsetAt(item.range.start) === declaration));

    const imported = await client.connection.sendRequest(DefinitionRequest.type, { textDocument: { uri }, position: client.position(uri, "greet(\"Bob\")", 1) }) as Location[];
    assert.ok(imported.some((item) => item.uri.endsWith("/lib/greet.ts")), JSON.stringify(imported));

    const help = await client.connection.sendRequest(SignatureHelpRequest.type, { textDocument: { uri }, position: client.position(uri, "greet(\"Ada\")", "greet(".length) });
    assert.ok(help?.signatures[0]?.label.includes("name: string"), JSON.stringify(help));
    assert.equal(help?.activeParameter, 0);
    assert.equal(help?.signatures[0]?.parameters?.length, 2);
  });

  test("references and rename cross .meeko and .ts files", async () => {
    const uri = await client.open(file("A.meeko"));
    const position = client.position(uri, "greet(\"Bob\")", 1);
    const found = await client.connection.sendRequest(ReferencesRequest.type, { textDocument: { uri }, position, context: { includeDeclaration: true } }) as Location[];
    const files = new Set(found.map((item) => item.uri.slice(item.uri.lastIndexOf("/") + 1)));
    assert.deepEqual([...files].sort(), ["A.meeko", "B.meeko", "Paths.meeko", "greet.ts"], JSON.stringify(found));
    const withoutDeclaration = await client.connection.sendRequest(ReferencesRequest.type, { textDocument: { uri }, position, context: { includeDeclaration: false } }) as Location[];
    assert.ok(withoutDeclaration.length < found.length);

    const prepared = await client.connection.sendRequest(PrepareRenameRequest.type, { textDocument: { uri }, position });
    assert.ok(prepared && "range" in prepared);
    const edit = await client.connection.sendRequest(RenameRequest.type, { textDocument: { uri }, position, newName: "salute" }) as WorkspaceEdit;
    const changes = edit.changes ?? {};
    const library = Object.keys(changes).find((key) => key.endsWith("/lib/greet.ts"));
    const other = Object.keys(changes).find((key) => key.endsWith("/B.meeko"));
    assert.ok(library && other && changes[uri], JSON.stringify(edit));
    assert.match(applyEdits(await readFile(file("lib/greet.ts"), "utf8"), changes[library]!), /export function salute\(/);
    const renamedB = applyEdits(await readFile(file("B.meeko"), "utf8"), changes[other]!);
    assert.match(renamedB, /import \{ salute \} from/);
    assert.match(renamedB, /const text = salute\("Eve"\)/);
    const renamedA = applyEdits(client.document(uri).getText(), changes[uri]!);
    assert.equal((renamedA.match(/salute/g) ?? []).length, 3);
  });

  test("uses the project tsconfig instead of fixed compiler options", async () => {
    const uri = await client.open(file("Paths.meeko"));
    const definitions = await client.connection.sendRequest(DefinitionRequest.type, { textDocument: { uri }, position: client.position(uri, "greet(\"Paths\")", 1) }) as Location[];
    assert.ok(definitions.some((item) => item.uri.endsWith("/lib/greet.ts")), JSON.stringify(definitions));

    // Diagnostics come from meeko check, which honours the same `paths`: the alias resolves
    // and only the real type error is published, exactly as the CLI reports it.
    const typed = await client.open(file("PathsTyped.meeko"));
    const diagnostics = await client.waitForDiagnostics(typed, (items) => items.length > 0);
    assert.deepEqual(diagnostics.map((item) => item.code), ["TS2322"], JSON.stringify(diagnostics));
    const cli = await checkSource(client.document(typed).getText(), file("PathsTyped.meeko"));
    assert.deepEqual(cli.map((item) => item.code), ["TS2322"]);
    assert.equal(client.document(typed).getText(diagnostics[0]!.range), "text");
  });

  test("document symbols and folding ranges describe every section", async () => {
    const uri = await client.open(file("A.meeko"));
    const symbols = await client.connection.sendRequest(DocumentSymbolRequest.type, { textDocument: { uri } }) as DocumentSymbol[];
    assert.deepEqual(symbols.map((item) => item.name), ["<script>", "<template>", "<style>"]);
    assert.deepEqual(symbols[0]!.children?.map((item) => item.name), ["greet", "count", "message"]);
    assert.ok(symbols[1]!.children?.some((item) => item.name.startsWith("section")));
    assert.ok(symbols[2]!.children?.some((item) => item.name === ".a"));

    const ranges = await client.connection.sendRequest(FoldingRangeRequest.type, { textDocument: { uri } }) ?? [];
    const lines = client.document(uri).getText().split("\n");
    const lineOf = (needle: string) => lines.findIndex((line) => line.includes(needle));
    assert.ok(ranges.some((range) => range.startLine === lineOf("<script") && range.endLine >= lineOf("const message")), JSON.stringify(ranges));
    assert.ok(ranges.some((range) => range.startLine === lineOf("<section")), "template element");
    assert.ok(ranges.some((range) => range.startLine === lineOf(".a {")), "style rule");
  });

  test("formats script, template and style sections", async () => {
    const source = '<script lang="ts">\nconst count=signal(0);\n</script>\n<template><button  class="counter">{count.value}</button></template>\n<style>.counter{color:red;}</style>\n';
    const uri = await client.open(file("Format.meeko"), source);
    const edits = await client.connection.sendRequest(DocumentFormattingRequest.type, { textDocument: { uri }, options: { tabSize: 2, insertSpaces: true } }) ?? [];
    const formatted = applyEdits(source, edits);
    assert.ok(formatted.includes("const count = signal(0);"), formatted);
    assert.ok(formatted.includes('<button class="counter">'), formatted);
    assert.ok(formatted.includes("color: red;"), formatted);
    assert.ok(formatted.includes("<template>\n"), formatted);
  });

  test("semantic tokens color template references like their declarations, including multi-line expressions", async () => {
    const uri = await client.open(file("A.meeko"));
    const legend = { types: ["class", "enum", "interface", "namespace", "typeParameter", "type", "parameter", "variable", "enumMember", "property", "function", "method"] };
    const result = await client.connection.sendRequest(SemanticTokensRequest.type, { textDocument: { uri } });
    const data = result?.data ?? [];
    const tokens: Array<{ line: number; character: number; length: number; type: string; modifiers: number }> = [];
    let line = 0;
    let character = 0;
    for (let index = 0; index < data.length; index += 5) {
      line += data[index]!;
      character = data[index] === 0 ? character + data[index + 1]! : data[index + 1]!;
      tokens.push({ line, character, length: data[index + 2]!, type: legend.types[data[index + 3]!]!, modifiers: data[index + 4]! });
    }
    const document = client.document(uri);
    const tokenAt = (offset: number) => {
      const position = document.positionAt(offset);
      const token = tokens.find((item) => item.line === position.line && item.character <= position.character && position.character < item.character + item.length);
      assert.ok(token, `token at ${document.getText().slice(offset, offset + 10)}`);
      return token;
    };
    const text = document.getText();
    const declaration = tokenAt(text.indexOf("const message") + "const ".length);
    const usage = tokenAt(text.indexOf("message", text.indexOf("bind:title")));
    assert.deepEqual([usage.type, usage.modifiers], [declaration.type, declaration.modifiers]);
    assert.ok(document.positionAt(text.indexOf("message", text.indexOf("bind:title"))).line > document.positionAt(text.indexOf("bind:title")).line);
    assert.equal(tokenAt(text.indexOf("count.value", text.indexOf("<template>"))).type, "variable");
  });

  test("code actions add missing imports", async () => {
    const uri = await client.open(file("Missing.meeko"));
    const diagnostics = await client.waitForDiagnostics(uri, (items) => items.some((item) => item.code === "TS2304"));
    const missing = diagnostics.find((item) => item.code === "TS2304")!;
    const actions = await client.connection.sendRequest(CodeActionRequest.type, { textDocument: { uri }, range: missing.range, context: { diagnostics: [missing] } }) as CodeAction[];
    const action = actions.find((item) => /greet/.test(item.title) && /import/i.test(item.title));
    assert.ok(action?.edit?.changes?.[uri], JSON.stringify(actions.map((item) => item.title)));
    const fixed = applyEdits(client.document(uri).getText(), action.edit.changes[uri]!);
    assert.match(fixed, /^<script lang="ts">\nimport \{ greet \} from "\.\/lib\/greet\.js";\n/);
  });

  test("code actions resolve an ambiguous autoimport with an explicit import", async () => {
    const uri = await client.open(file("Ambiguous.meeko"));
    const diagnostics = await client.waitForDiagnostics(uri, (items) => items.some((item) => item.code === "MEEK_AUTOIMPORT"));
    const ambiguous = diagnostics.find((item) => item.code === "MEEK_AUTOIMPORT")!;
    assert.equal(client.document(uri).getText(ambiguous.range), "useCount");
    const actions = await client.connection.sendRequest(CodeActionRequest.type, { textDocument: { uri }, range: ambiguous.range, context: { diagnostics: [ambiguous] } }) as CodeAction[];
    const titles = actions.map((item) => item.title).filter((title) => title.startsWith("Import useCount"));
    assert.deepEqual(titles.sort(), ["Import useCount from app/composables/count.ts", "Import useCount from shared/utils/count.ts"]);
    const chosen = actions.find((item) => item.title === "Import useCount from shared/utils/count.ts")!;
    const fixed = applyEdits(client.document(uri).getText(), chosen.edit!.changes![uri]!);
    assert.match(fixed, /import \{ useCount \} from "\.\/shared\/utils\/count\.js";/);
    await client.change(uri, fixed);
    await client.waitForDiagnostics(uri, (items) => items.length === 0);
  });

  test("code actions remove params passed to a static route href", async () => {
    const uri = await client.open(file("Href.meeko"));
    const text = client.document(uri).getText();
    const at = (needle: string) => {
      const start = client.document(uri).positionAt(text.indexOf(needle));
      return { start, end: start };
    };
    const first = await client.connection.sendRequest(CodeActionRequest.type, { textDocument: { uri }, range: at("href(routes, \"/about\", { params"), context: { diagnostics: [] } }) as CodeAction[];
    const removeAll = first.find((item) => item.title.startsWith("Remove params"));
    assert.ok(removeAll, JSON.stringify(first.map((item) => item.title)));
    assert.match(applyEdits(text, removeAll.edit!.changes![uri]!), /const about = href\(routes, "\/about"\);/);
    const second = await client.connection.sendRequest(CodeActionRequest.type, { textDocument: { uri }, range: at("search: {"), context: { diagnostics: [] } }) as CodeAction[];
    const removeParams = second.find((item) => item.title.startsWith("Remove params"));
    assert.match(applyEdits(text, removeParams!.edit!.changes![uri]!), /const tab = href\(routes, "\/about", \{ search: \{ tab: "a" \} \}\);/);
    const dynamic = await client.connection.sendRequest(CodeActionRequest.type, { textDocument: { uri }, range: at("/users/[id]"), context: { diagnostics: [] } }) as CodeAction[];
    assert.ok(!dynamic.some((item) => item.title.includes("/users/[id]")), "dynamic routes keep their params");
  });

  test("a saved dependency refreshes the diagnostics of open components", async () => {
    const uri = await client.open(file("B.meeko"));
    await client.waitForDiagnostics(uri, (items) => items.length === 0);
    const library = file("lib/greet.ts");
    const original = await readFile(library, "utf8");
    try {
      await writeFile(library, original.replace("name: string", "name: number"));
      await client.connection.sendNotification(DidChangeWatchedFilesNotification.type, { changes: [{ uri: pathToFileURL(library).href, type: FileChangeType.Changed }] });
      await client.waitForDiagnostics(uri, (items) => items.some((item) => item.code === "TS2345"));
    } finally {
      await writeFile(library, original);
      await client.connection.sendNotification(DidChangeWatchedFilesNotification.type, { changes: [{ uri: pathToFileURL(library).href, type: FileChangeType.Changed }] });
    }
    await client.waitForDiagnostics(uri, (items) => items.length === 0);
  });
});

describe("Meeko language server configuration and contracts", () => {
  test("trusted workspaces execute the project config; untrusted ones read it statically", async () => {
    const root = await project("lsp-config-", {
      "meeko.config.ts": 'const layers = ["./layers/base"];\nexport default { extends: layers };\n',
      "layers/base/app/pages/index.meeko": '<script lang="ts"></script><template><p>Base</p></template>\n',
      "layers/base/app/composables/greeting.ts": "export function layerGreeting(): string { return \"hi\"; }\n",
      "Use.meeko": '<script lang="ts">\nconst text: string = layerGreeting();\n</script>\n<template><p>{text}</p></template>\n',
    });
    try {
      const trusted = await inProcess(root, { trusted: true });
      try {
        const uri = await trusted.open(join(root, "Use.meeko"));
        assert.deepEqual(await trusted.waitForDiagnostics(uri, () => true), []);
        const hover = await trusted.connection.sendRequest(HoverRequest.type, { textDocument: { uri }, position: trusted.position(uri, "layerGreeting", 2) });
        assert.match((hover?.contents as MarkupContent).value, /layerGreeting\(\): string/);
      } finally { await trusted.close(); }
      const untrusted = await inProcess(root, { trusted: false });
      try {
        const uri = await untrusted.open(join(root, "Use.meeko"));
        const diagnostics = await untrusted.waitForDiagnostics(uri, () => true);
        assert.ok(diagnostics.some((item) => item.code === "TS2304"), JSON.stringify(diagnostics));
      } finally { await untrusted.close(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("project page contracts run on save only in trusted workspaces, with the props type as range", async () => {
    const layoutSource = '<script lang="ts">const props = defineProps<{ outlet: object; missing: string }>();</script><template><p>Shell</p></template>\n';
    const root = await project("lsp-contract-", {
      "app/pages/index.meeko": '<script lang="ts"></script><template><p>Home</p></template>\n',
      "app/layouts/default.meeko": layoutSource,
    });
    try {
      const layout = join(root, "app", "layouts", "default.meeko");
      const trusted = await inProcess(root);
      try {
        const uri = await trusted.open(layout);
        const diagnostics = await trusted.waitForDiagnostics(uri, (items) => items.some((item) => item.code === "MEEK_LAYOUT_PROPS"));
        const contract = diagnostics.find((item) => item.code === "MEEK_LAYOUT_PROPS")!;
        assert.equal(trusted.document(uri).getText(contract.range), "{ outlet: object; missing: string }");
        const fixed = layoutSource.replace("; missing: string", "");
        await writeFile(layout, fixed);
        await trusted.change(uri, fixed);
        await trusted.connection.sendNotification(DidSaveTextDocumentNotification.type, { textDocument: { uri } });
        await trusted.waitForDiagnostics(uri, (items) => !items.some((item) => item.code === "MEEK_LAYOUT_PROPS"));
      } finally { await trusted.close(); }
      await writeFile(layout, layoutSource);
      const untrusted = await inProcess(root, { trusted: false });
      try {
        const uri = await untrusted.open(layout);
        await untrusted.waitForDiagnostics(uri, () => true);
        await new Promise((resolve) => setTimeout(resolve, 2500));
        assert.ok(!untrusted.diagnostics.get(uri)?.some((item) => item.code === "MEEK_LAYOUT_PROPS"));
      } finally { await untrusted.close(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe("meeko lsp --stdio", () => {
  test("a spawned server answers initialize, diagnostics and hover over JSON-RPC like meeko check", async () => {
    const root = await project("lsp-stdio-", { "Bad.meeko": badComponent });
    const child = spawn(process.execPath, [resolve("dist/cli.js"), "lsp", "--stdio"], { stdio: ["pipe", "pipe", "inherit"] });
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    const client = new Client(createProtocolConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin)));
    try {
      const result = await client.initialize(root);
      assert.equal(result.serverInfo?.name, "meeko-language-server");
      assert.equal(result.serverInfo?.version, JSON.parse(await readFile("package.json", "utf8")).version);
      const uri = await client.open(join(root, "Bad.meeko"));
      const diagnostics = await client.waitForDiagnostics(uri, (items) => items.length >= 2);
      const cliPath = resolve("dist/cli.js");
      const cli = await new Promise<string>((done, reject) => {
        const check = spawn(process.execPath, [cliPath, "check", join(root, "Bad.meeko"), "--json"], { stdio: ["ignore", "pipe", "inherit"] });
        let output = "";
        check.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        check.once("error", reject);
        check.once("exit", () => done(output));
      });
      const expected = (JSON.parse(cli) as Array<{ code: string; location: { offset: number } }>).map((item) => `${item.code}:${item.location.offset}`);
      assert.deepEqual(diagnostics.map((item) => `${item.code}:${client.document(uri).offsetAt(item.range.start)}`).sort(), [...new Set(expected)].sort());
      const hover = await client.connection.sendRequest(HoverRequest.type, { textDocument: { uri }, position: client.position(uri, "count.missing", 1) });
      assert.match((hover?.contents as MarkupContent).value, /const count: 1/);
      await client.connection.sendRequest(ShutdownRequest.type);
      await client.connection.sendNotification(ExitNotification.type);
      assert.equal(await exited, 0);
    } finally {
      client.connection.dispose();
      child.kill();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("the meeko-language-server bin starts the same server and rejects a missing transport", async () => {
    const usage = spawn(process.execPath, [resolve("dist/language-server/main.js")], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    usage.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    assert.equal(await new Promise((resolve) => usage.once("exit", resolve)), 1);
    assert.match(stderr, /--stdio/);
    const child = spawn(process.execPath, [resolve("dist/language-server/main.js"), "--stdio"], { stdio: ["pipe", "pipe", "inherit"] });
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    const client = new Client(createProtocolConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin)));
    try {
      const result = await client.initialize(resolve("."));
      assert.ok(result.capabilities.semanticTokensProvider);
      await client.connection.sendRequest(ShutdownRequest.type);
      await client.connection.sendNotification(ExitNotification.type);
      assert.equal(await exited, 0);
    } finally {
      client.connection.dispose();
      child.kill();
    }
  });
});
