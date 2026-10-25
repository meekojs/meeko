import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire as createModuleRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { compileWithAutoImports } from "./autoimports.js";
import { originalOffset } from "./compiler/mapping.js";
import type { SourceMapping } from "./compiler/mapping.js";
import { moduleSpecifiers } from "./compiler/import-graph.js";
import { projectRoot } from "./compiler/project-root.js";
import { compileError, MeekoCompileError, locate } from "./compiler/sfc.js";
import type { CompileDiagnostic } from "./compiler/sfc.js";

const execFileAsync = promisify(execFile);
const typescriptPackage = fileURLToPath(import.meta.resolve("typescript/package.json"));
const tscPath = join(dirname(typescriptPackage), "bin", "tsc");
// The JS launcher spawns tsc.exe without windowsHide, which flashes a terminal in VS Code.
const nativeTscPath = process.platform === "win32"
  ? join(dirname(createModuleRequire(typescriptPackage).resolve(`@typescript/typescript-win32-${process.arch}/package.json`)), "lib", "tsc.exe")
  : undefined;
const tscExecutable = nativeTscPath && nativeTscPath.length >= 248 ? `\\\\?\\${nativeTscPath}` : nativeTscPath ?? process.execPath;

interface GeneratedEntry {
  original: string;
  generated: string;
  source: string;
  code: string;
  mappings: SourceMapping[];
}

async function compileGraph(source: string, filename: string): Promise<{ root: GeneratedEntry; entries: Map<string, GeneratedEntry>; tempDirectory: string }> {
  const byOriginal = new Map<string, GeneratedEntry>();
  const byGenerated = new Map<string, GeneratedEntry>();
  const nonce = randomUUID();
  const rootDirectory = projectRoot(filename);
  const generatedDirectory = join(rootDirectory, ".meeko", "check", nonce);
  async function add(original: string, content: string): Promise<GeneratedEntry> {
    const previous = byOriginal.get(original);
    if (previous) return previous;
    const target = relative(rootDirectory, original).split(/[\\/]/)[0] === "server" ? "server" : "client";
    const compiled = await compileWithAutoImports(content, original, {}, target);
    const entry: GeneratedEntry = {
      original, source: content, code: compiled.code,
      generated: join(generatedDirectory, relative(rootDirectory, original) + ".ts"),
      mappings: compiled.mappings.map((mapping) => ({ ...mapping })),
    };
    byOriginal.set(original, entry);
    byGenerated.set(entry.generated, entry);
    const edits: Array<{ start: number; end: number; text: string }> = [];
    for (const specifier of moduleSpecifiers(entry.code, entry.generated)) {
      const { value, start, end } = specifier;
      if (!value.endsWith(".meeko") && !value.startsWith(".")) continue;
      if (value.endsWith(".meeko") && !value.startsWith(".")) {
        throw compileError(content, original, "MEEK033", "Component imports must use relative .meeko paths", originalOffset(entry.mappings, start) ?? 0);
      }
      let destination: string;
      if (value.endsWith(".meeko")) {
        const childFilename = resolve(dirname(original), value);
        let childSource: string;
        try {
          childSource = await readFile(childFilename, "utf8");
        } catch {
          throw compileError(content, original, "MEEK034", `Component import not found: ${value}`, originalOffset(entry.mappings, start) ?? 0);
        }
        const child = await add(childFilename, childSource);
        destination = child.generated.replace(/\.ts$/, ".js");
      } else {
        destination = resolve(dirname(original), value);
      }
      let target = relative(dirname(entry.generated), destination).replaceAll("\\", "/");
      if (!target.startsWith("./") && !target.startsWith("../")) target = `./${target}`;
      edits.push({ start, end, text: target });
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
  return { root, entries: byGenerated, tempDirectory: generatedDirectory };
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

  let output = "";
  try {
    for (const entry of graph.entries.values()) {
      await mkdir(dirname(entry.generated), { recursive: true });
      await writeFile(entry.generated, entry.code, { encoding: "utf8", flag: "wx" });
    }
    try {
      const result = await execFileAsync(tscExecutable, [
        ...(nativeTscPath ? [] : [tscPath]), "--ignoreConfig", "--noEmit", "--pretty", "false", "--strict", "--skipLibCheck",
        "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax",
        "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022",
        "--lib", "es2022,dom", graph.root.generated,
      ], { cwd: dirname(absolute), maxBuffer: 8 * 1024 * 1024, windowsHide: true });
      output = result.stdout + result.stderr;
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
      if (!output.trim()) throw error;
    }
  } finally {
    await rm(graph.tempDirectory, { recursive: true, force: true });
  }

  const typed = parseTypeScriptOutput(output);
  if (typed.length === 0 && output.trim()) throw new Error(`TypeScript 7 check failed: ${output.trim()}`);
  return Promise.all(typed.map(async (diagnostic) => {
    const reported = resolve(dirname(absolute), diagnostic.file);
    const entry = graph.entries.get(reported);
    if (entry) {
      const offset = originalOffset(entry.mappings, generatedOffset(entry.code, diagnostic.line, diagnostic.column));
      return {
        code: diagnostic.code,
        message: offset === undefined ? `Generated TypeScript: ${diagnostic.message}` : diagnostic.message,
        filename: entry.original,
        location: locate(entry.source, offset ?? 0),
      };
    }
    // TypeScript also checks .ts dependencies imported by the .meeko graph.
    // Their positions already refer to the original file, not generated code.
    let imported: string;
    try { imported = await readFile(reported, "utf8"); }
    catch {
      return { code: diagnostic.code, message: `Generated TypeScript: ${diagnostic.message}`, filename: absolute, location: locate(source, 0) };
    }
    return {
      code: diagnostic.code,
      message: diagnostic.message,
      filename: reported,
      location: locate(imported, generatedOffset(imported, diagnostic.line, diagnostic.column)),
    };
  }));
}
