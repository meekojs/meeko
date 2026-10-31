import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkSource } from "../src/check.ts";
import { linkRepositoryPackages } from "./helpers/temp-project.ts";

test("a consumer can check external components repeatedly without escaped temporary files", async () => {
  // Keep the consumer on the package's volume: Windows cannot express relative ESM imports
  // between C: (the system temp directory) and a package installed on D:.
  const temporary = resolve(".meeko", "test-ui");
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(join(temporary, "consumer-"));
  try {
    await linkRepositoryPackages(root);
    await writeFile(join(root, "package.json"), '{"type":"module","private":true}');
    await writeFile(join(root, "meeko.config.mjs"), 'export default {};');
    await writeFile(join(temporary, "Button.meeko"), '<template><button type="button">Save</button></template>');
    await mkdir(join(root, "app", "pages"), { recursive: true });
    const filename = join(root, "app", "pages", "index.meeko");
    const source = '<script lang="ts">import * as Button from "../../../Button.meeko";</script><template><Button /></template>';
    await writeFile(filename, source);
    for (let pass = 0; pass < 2; pass++) assert.deepEqual(await checkSource(source, filename), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
