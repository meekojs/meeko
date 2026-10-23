#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { compile } from "./compiler.js";

const [command, input, output] = process.argv.slice(2);
if (command !== "compile" || !input || !output) {
  process.stderr.write("Usage: meeko compile <component.meeko> <output.ts>\n");
  process.exitCode = 1;
} else {
  try {
    const source = await readFile(input, "utf8");
    const result = compile(source, input);
    await writeFile(output, result.code, "utf8");
    process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
