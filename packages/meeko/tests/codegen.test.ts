import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { compile } from "../src/compiler";

const cases = [
  ["examples/counter/Counter.meeko", "./fixtures/codegen/Counter.meeko", "946883c164f689af7a76469205fd7c8cce978f8a14d0f517fb14a010bf5c69e9", "e63c1ab12c8478c76d4869ba48227e586d32ffb3d9071c2e5008909332a2e883", "d31ad7fce5f3db8a7bbf38eaa220d127dd062684b64d2baf90cc6f3aecfc06c6", "369511807c0ee7171482fc755ada598824ee1976fc6bfda1798db15642d12029"],
  ["examples/nested/Parent.meeko", "./fixtures/codegen/Parent.meeko", "4cc7ba0e071c074e33f187b309e7f6ccfb9a68fdd5052f87b803f99bed0c05f2", "b42786ec882fec4f7ac29c15436eebe5cb38a508a125220e50a3a83389b3009f", "8562ba850fd09fac22d1223607400f68e7d17f6618659865e2bdbcd9e61d1f5d", "7f53257adff043fd689e7f341391861c4954cda822141259154a2b72e13bc708"],
  ["tests/fixtures/CleanupErrors.meeko", "./fixtures/codegen/CleanupErrors.meeko", "48b74e7e136cf2d81c9442bf259c9ef3e3098a3e1a3133f6730fac6e97c04799", "ba531a02520946cb3385dfe6bf37fa2e1793b43f7d2de02987d7861c94be6f70", "4b390ffeff0a0ae8c6f31ece78145223601394e853f55efdb6036c34eeac8f49", "f77dc210ed4bf6106012b27a6a38f7b1baaa4a19f2c64e636c3c7283f77f5694"],
] as const;

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

test("codegen preserves generated code and source mappings across the extraction", () => {
  for (const [filename, fixture, coldCode, hotCode, coldMappings, hotMappings] of cases) {
    // Frozen inputs keep this extraction golden independent of style changes to public examples.
    // The original filename remains part of generated diagnostics; canonical LF makes checkout EOL irrelevant.
    const source = readFileSync(new URL(fixture, import.meta.url), "utf8").replaceAll("\r\n", "\n");
    for (const [hot, expectedCode, expectedMappings] of [[false, coldCode, coldMappings], [true, hotCode, hotMappings]] as const) {
      const result = compile(source, filename, { hot });
      assert.equal(hash(result.code), expectedCode, `${filename} hot=${hot} code`);
      assert.equal(hash(JSON.stringify(result.mappings)), expectedMappings, `${filename} hot=${hot} mappings`);
    }
  }
});
