import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "@typescript/typescript6";
import { MeekoProject } from "../src/language-server/project.ts";

const page = (field: string) => `<script server lang="ts">
const { context } = usePage();
if (context.session.current?.data.role !== "owner") redirect("/login");
export const user: string = context.session.current.data.${field};
</script>

<template><p>{user}</p></template>
`;

test("the editor types a page's session with the project's MeekoSession declaration", async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko", "lsp-session-types-"));
  let project: MeekoProject | undefined;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({ compilerOptions: {
      strict: true, module: "ESNext", moduleResolution: "Bundler", target: "ES2022", lib: ["ES2022", "DOM"], types: [], noEmit: true, skipLibCheck: true,
    } })}\n`);
    await mkdir(join(root, "server", "types"), { recursive: true });
    await writeFile(join(root, "server", "types", "session.d.ts"), `import type {} from "@meekojs/meeko/server";
declare module "@meekojs/meeko/server" {
  interface MeekoSession { user: string; role: "owner" }
}
`);
    await mkdir(join(root, "app", "pages"), { recursive: true });
    project = new MeekoProject(root, { trusted: false });
    await project.ready();
    const diagnostics = (field: string): string[] => {
      const filename = join(root, "app", "pages", "dashboard.meeko");
      const component = project!.setDocument(filename, page(field));
      assert.ok(component, String(project!.componentError(filename)));
      const files = [component.virtualFilename, ...(component.server ? [component.server.virtualFilename] : [])];
      return files.flatMap((file) => project!.service.getSemanticDiagnostics(file))
        .map((item) => `${item.code}: ${ts.flattenDiagnosticMessageText(item.messageText, " ")}`);
    };
    assert.deepEqual(diagnostics("user"), []);
    assert.ok(diagnostics("email").some((message) => /Property 'email' does not exist on type 'MeekoSession'/.test(message)));
  } finally {
    project?.service.dispose();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
