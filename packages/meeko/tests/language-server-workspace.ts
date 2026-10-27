import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Position } from "vscode-languageserver/node";
import type { FeatureContext, LocatedDocument } from "../src/language-server/features.ts";
import { MeekoProject } from "../src/language-server/project.ts";

/** A component opened in a test project, with helpers to find positions in its text. */
export interface OpenedComponent extends FeatureContext {
  /** Position of `needle` (after `from`, if given) plus `delta` characters. */
  at(needle: string, delta?: number, from?: string): Position;
  offset(needle: string, delta?: number, from?: string): number;
}

export interface LanguageProject {
  readonly root: string;
  readonly project: MeekoProject;
  file(name: string): string;
  /** Opens a component with its text on disk or `text`, with the project's application index. */
  open(name: string, text?: string): Promise<OpenedComponent>;
  dispose(): Promise<void>;
}

/** Resolves a file to its URI and text on disk, like the server's `locate`. */
export function locateOnDisk(filename: string): LocatedDocument | undefined {
  const text = ts.sys.readFile(filename);
  if (text === undefined) return undefined;
  const uri = pathToFileURL(filename).href;
  return { uri, document: TextDocument.create(uri, filename.endsWith(".meeko") ? "meeko" : "typescript", 0, text) };
}

/**
 * A temporary Meeko project under `.meeko/` whose package imports resolve to `src/`, so the tests
 * do not depend on a build of `dist/`. The workspace is untrusted: the configuration is read statically.
 */
export async function languageProject(prefix: string, files: Record<string, string>): Promise<LanguageProject> {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko", prefix));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      strict: true, module: "esnext", moduleResolution: "bundler", target: "es2023", types: [], noEmit: true, allowArbitraryExtensions: true,
      paths: {
        "@meekojs/meeko/framework": ["../../src/framework.ts"],
        "@meekojs/meeko/server": ["../../src/framework-server.ts"],
        "@meekojs/meeko/internal": ["../../src/internal.ts"],
        "@meekojs/meeko": ["../../src/index.ts"],
      },
    },
    include: ["**/*.ts"],
  })}\n`);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
  const project = new MeekoProject(root, { trusted: false });
  await project.ready();
  const file = (name: string) => join(root, name);
  return {
    root,
    project,
    file,
    async open(name, text) {
      const filename = file(name);
      const source = text ?? files[name] ?? ts.sys.readFile(filename);
      assert.ok(source !== undefined, `Missing ${name}`);
      const component = project.setDocument(filename, source);
      assert.ok(component, String(project.componentError(filename)));
      const document = TextDocument.create(pathToFileURL(filename).href, "meeko", 1, source);
      const offset = (needle: string, delta = 0, from?: string): number => {
        const start = from === undefined ? 0 : source.indexOf(from);
        const found = source.indexOf(needle, Math.max(start, 0));
        assert.ok(found >= 0, `Missing ${needle}`);
        return found + delta;
      };
      return {
        project, component, document, app: await project.appIndex(),
        locate: (target) => target === filename ? { uri: document.uri, document } : locateOnDisk(target),
        offset,
        at: (needle, delta, from) => document.positionAt(offset(needle, delta, from)),
      };
    },
    async dispose() {
      project.dispose();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}

/** Decodes LSP semantic tokens with the server legend. */
export function decodeTokens(data: readonly number[], legend: { tokenTypes: readonly string[]; tokenModifiers: readonly string[] }): Array<{ line: number; character: number; length: number; type: string; modifiers: string[] }> {
  const tokens: Array<{ line: number; character: number; length: number; type: string; modifiers: string[] }> = [];
  let line = 0;
  let character = 0;
  for (let index = 0; index < data.length; index += 5) {
    line += data[index]!;
    character = data[index] === 0 ? character + data[index + 1]! : data[index + 1]!;
    const bits = data[index + 4]!;
    tokens.push({
      line, character, length: data[index + 2]!, type: legend.tokenTypes[data[index + 3]!]!,
      modifiers: legend.tokenModifiers.filter((_, bit) => (bits & (1 << bit)) !== 0),
    });
  }
  return tokens;
}
