import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { compile } from "./compiler.js";
import { originalOffset } from "./compiler/mapping.js";
import type { SourceMapping } from "./compiler/mapping.js";
import { compileError, MeekoCompileError, locate } from "./compiler/sfc.js";
import type { CompileDiagnostic } from "./compiler/sfc.js";

const execFileAsync = promisify(execFile);
const tscPath = join(dirname(fileURLToPath(import.meta.resolve("typescript/package.json"))), "bin", "tsc");

interface GeneratedEntry {
  original: string;
  generated: string;
  source: string;
  code: string;
  mappings: SourceMapping[];
}

async function compileGraph(source: string, filename: string): Promise<{ root: GeneratedEntry; entries: Map<string, GeneratedEntry> }> {
  const byOriginal = new Map<string, GeneratedEntry>();
  const byGenerated = new Map<string, GeneratedEntry>();
  const nonce = randomUUID();
  async function add(original: string, content: string): Promise<GeneratedEntry> {
    const previous = byOriginal.get(original);
    if (previous) return previous;
    const compiled = compile(content, original);
    const entry: GeneratedEntry = {
      original, source: content, code: compiled.code,
      generated: join(dirname(original), `.${basename(original)}.__meeko_check_${nonce}.ts`),
      mappings: compiled.mappings.map((mapping) => ({ ...mapping })),
    };
    byOriginal.set(original, entry);
    byGenerated.set(entry.generated, entry);
    const importPattern = /\b(?:from\s*|import\s*)["']([^"']+\.meeko)["']/g;
    const edits: Array<{ start: number; end: number; text: string }> = [];
    for (const match of entry.code.matchAll(importPattern)) {
      const specifier = match[1]!;
      const start = match.index + match[0].indexOf(specifier);
      if (!specifier.startsWith(".")) {
        throw compileError(content, original, "MEEK033", "Component imports must use relative .meeko paths", originalOffset(entry.mappings, start) ?? 0);
      }
      const childFilename = resolve(dirname(original), specifier);
      let childSource: string;
      try {
        childSource = await readFile(childFilename, "utf8");
      } catch {
        throw compileError(content, original, "MEEK034", `Component import not found: ${specifier}`, originalOffset(entry.mappings, start) ?? 0);
      }
      const child = await add(childFilename, childSource);
      let target = relative(dirname(entry.generated), child.generated).replaceAll("\\", "/").replace(/\.ts$/, ".js");
      if (!target.startsWith("./") && !target.startsWith("../")) target = `./${target}`;
      edits.push({ start, end: start + specifier.length, text: target });
    }
    for (const edit of edits.reverse()) {
      const delta = edit.text.length - (edit.end - edit.start);
      entry.code = entry.code.slice(0, edit.start) + edit.text + entry.code.slice(edit.end);
      for (const mapping of entry.mappings) {
        if (mapping.generatedStart >= edit.end) mapping.generatedStart += delta;
        if (mapping.generatedEnd >= edit.end) mapping.generatedEnd += delta;
      }
    }
    return entry;
  }
  const root = await add(filename, source);
  return { root, entries: byGenerated };
}

function generatedOffset(code: string, line: number, column: number): number {
  const lines = code.split("\n");
  let offset = 0;
  for (let index = 0; index < line - 1; index++) offset += (lines[index]?.length ?? 0) + 1;
  return offset + column - 1;
}

function parseTypeScriptOutput(output: string): Array<{ file: string; line: number; column: number; code: string; message: string }> {
  const diagnostics: Array<{ file: string; line: number; column: number; code: string; message: string }> = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.*)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);
    if (match) diagnostics.push({ file: match[1] ?? "", line: Number(match[2]), column: Number(match[3]), code: `TS${match[4]}`, message: match[5] ?? "" });
    else if (line.trim() && diagnostics.length > 0) diagnostics[diagnostics.length - 1]!.message += `\n${line}`;
  }
  return diagnostics;
}

/** Comprueba un componente con TypeScript 7 y devuelve errores ubicados en el .meeko original. */
export async function checkSource(source: string, filename: string): Promise<CompileDiagnostic[]> {
  const absolute = resolve(filename);
  let graph: Awaited<ReturnType<typeof compileGraph>>;
  try {
    graph = await compileGraph(source, absolute);
  } catch (error) {
    if (error instanceof MeekoCompileError) return [error.diagnostic];
    throw error;
  }

  const written: string[] = [];
  let output = "";
  try {
    for (const entry of graph.entries.values()) {
      await writeFile(entry.generated, entry.code, { encoding: "utf8", flag: "wx" });
      written.push(entry.generated);
    }
    try {
      const result = await execFileAsync(process.execPath, [
        tscPath, "--ignoreConfig", "--noEmit", "--pretty", "false", "--strict", "--skipLibCheck",
        "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax",
        "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022",
        "--lib", "es2022,dom", graph.root.generated,
      ], { cwd: dirname(absolute), maxBuffer: 8 * 1024 * 1024 });
      output = result.stdout + result.stderr;
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
      if (!output.trim()) throw error;
    }
  } finally {
    await Promise.all(written.map((path) => unlink(path)));
  }

  const typed = parseTypeScriptOutput(output);
  if (typed.length === 0 && output.trim()) throw new Error(`TypeScript 7 check failed: ${output.trim()}`);
  return typed.map((diagnostic) => {
    const entry = graph.entries.get(resolve(dirname(absolute), diagnostic.file));
    const offset = entry ? originalOffset(entry.mappings, generatedOffset(entry.code, diagnostic.line, diagnostic.column)) : undefined;
    const message = entry && offset !== undefined ? diagnostic.message : `Generated TypeScript: ${diagnostic.message}`;
    return { code: diagnostic.code, message, filename: entry?.original ?? absolute, location: locate(entry?.source ?? source, offset ?? 0) };
  });
}
