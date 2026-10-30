import assert from "node:assert/strict";
import test from "node:test";
import { completionList } from "../src/language-server/features.ts";
import { languageProject } from "./language-server-workspace.ts";

test("useForm completes missing schema fields while initial is incomplete", async () => {
  const source = `<script lang="ts">
type CaseInput = { name: string; detail: string; kind: string; url: string; host: string; featured: boolean };
const caseInput = { "~standard": { version: 1 as const, vendor: "test", validate: (value: unknown) => ({ value: value as CaseInput }), types: undefined as { readonly input: CaseInput; readonly output: CaseInput } | undefined } };
const cases = useForm({
  schema: caseInput,
  initial: { name: '', detail: '', kind: '', url: '', host: '', fe/*cursor*/},
  submit: (values) => values.name,
});
</script><template><p>{cases.dirty.value}</p></template>`;
  const workspace = await languageProject("form-completion-", { "Page.meeko": source.replace("/*cursor*/", "") });
  try {
    for (const prefix of ["", "fe"]) {
      const marked = source.replace("fe/*cursor*/", `${prefix}/*cursor*/`);
      const marker = marked.indexOf("/*cursor*/");
      const opened = await workspace.open("Page.meeko", marked.replace("/*cursor*/", ""));
      const items = completionList(opened, opened.document.positionAt(marker))?.items ?? [];
      assert.ok(items.some((item) => item.label === "featured"), `${prefix || "empty"}: ${items.slice(0, 25).map((item) => item.label).join(", ")}`);
    }
  } finally {
    await workspace.dispose();
  }
});
