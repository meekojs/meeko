import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "../src/compiler";

const cases = [
  ["examples/counter/Counter.meeko", "29563779bd27ddf34ebd3143a30548e27e67fcf3dd6290b444080677f5bce2ea", "0b7543eab376a28cf5e10a23888bdeb552a33951158a5cf6dc6bb143aa8f52a8", "2f6b35eb05f4c16e143195d2df58fc9e0d423af5df7bba29cfc8cfad8154d393", "0081d2ca435fa6a9b92c9caeedd99a0989a2115bfcd77a0b30f60f0173b08c84"],
  ["examples/nested/Parent.meeko", "cf0d33151010d44733f362ff85390b966f76b74dd1eee08e0d22f8b1a343d9f7", "599cd69439bf1d71b00b17b5cb613e11cb4216989c5b7840fdc4ef2d17eac8eb", "d0ac24df1efeec253eb05d0e1ccec95df3474a692cfa5907a4531a19d3d7994d", "eb60278750140e434166c10bf5053b323dde259592b08775c417848f0e8ad9a5"],
  ["tests/fixtures/CleanupErrors.meeko", "f5eca2841ef371c2dc2285e9b560b1fbe3fe1c5ffdf09858cda57912b4ebcc87", "39b6d8001954cd4ab416f91b3a8868ae25edf1b89d13d651139c96ebec3444f2", "26e800af8b50536949f84b9aeee0b1ca5b078a7704f82472d75e7ec9ebcb1580", "35afa2af6fbf4c0d761d1b3daf7ffeb2695fef743ae3c3a79f2454a1b5ae501a"],
] as const;

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

test("codegen preserves generated code and source mappings across the extraction", () => {
  for (const [filename, coldCode, hotCode, coldMappings, hotMappings] of cases) {
    const source = readFileSync(filename, "utf8");
    for (const [hot, expectedCode, expectedMappings] of [[false, coldCode, coldMappings], [true, hotCode, hotMappings]] as const) {
      const result = compile(source, filename, { hot });
      assert.equal(hash(result.code), expectedCode, `${filename} hot=${hot} code`);
      assert.equal(hash(JSON.stringify(result.mappings)), expectedMappings, `${filename} hot=${hot} mappings`);
    }
  }
});
