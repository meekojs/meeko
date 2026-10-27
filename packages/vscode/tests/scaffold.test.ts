import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { componentFile, endpointFiles, pageFile, projectRootOf, schemaLibrary } from "../src/scaffold.js";
import type { ScaffoldFile } from "../src/scaffold.js";

let root: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "meeko-scaffold-"));
  await mkdir(join(root, "app", "pages"), { recursive: true });
  await mkdir(join(root, "app", "components", "App"), { recursive: true });
  await mkdir(join(root, "shared", "schemas"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { valibot: "^1.0.0" } }));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

const relative = (file: ScaffoldFile | string): string => {
  assert.ok(typeof file !== "string", String(file));
  return file.path.slice(root.length + 1).replaceAll("\\", "/");
};

test("the project is the nearest folder with app/pages or meeko.config", () => {
  assert.equal(projectRootOf(join(root, "app", "components", "App")), root);
  assert.equal(schemaLibrary(root), "valibot");
});

test("components go into the folder their name starts with, as autoimports name them", () => {
  assert.equal(relative(componentFile(root, "AppCard")), "app/components/App/Card.meeko");
  assert.equal(relative(componentFile(root, "UiBadge")), "app/components/UiBadge.meeko");
  assert.equal(relative(componentFile(root, "Ui/Badge")), "app/components/Ui/Badge.meeko");
  assert.equal((componentFile(root, "AppCard", "\t") as ScaffoldFile).content, "<template>\n\t<div></div>\n</template>\n");
  assert.match(componentFile(root, "app-card") as string, /PascalCase/);
});

test("pages follow the route: a static segment gets index.meeko, a parameter its own file", () => {
  assert.equal(relative(pageFile(root, "/")), "app/pages/index.meeko");
  assert.equal(relative(pageFile(root, "/users")), "app/pages/users/index.meeko");
  assert.equal(relative(pageFile(root, "/users/[id]")), "app/pages/users/[id].meeko");
  assert.match((pageFile(root, "/users/[id]") as ScaffoldFile).content, /useHead\(\{ title: "Id" \}\)/);
  assert.match(pageFile(root, "users") as string, /empieza por \//);
  assert.match(pageFile(root, "/Users") as string, /no es un segmento válido/);
});

test("an endpoint comes with its public schemas, added to the resource's schema file", async () => {
  const [endpoint, schemas] = endpointFiles(root, "GET", "/api/users/[id]", "valibot") as ScaffoldFile[];
  assert.equal(relative(endpoint!), "server/api/users/[id].get.ts");
  assert.equal(endpoint!.content, `import { defineApiRoute } from "@meekojs/meeko/server";
import { getUsersByIdParams, getUsersByIdResponse } from "../../../shared/schemas/users.js";

export default defineApiRoute({
  params: getUsersByIdParams,
  response: getUsersByIdResponse,
  handler: () => ({ ok: true }),
});
`);
  assert.equal(relative(schemas!), "shared/schemas/users.ts");
  assert.equal(schemas!.append, undefined);
  assert.equal(schemas!.content, `import * as v from "valibot";

export const getUsersByIdParams = v.object({ id: v.string() });
export const getUsersByIdResponse = v.object({ ok: v.boolean() });
`);
  await writeFile(schemas!.path, schemas!.content);
  const [created, added] = endpointFiles(root, "POST", "/users", "zod") as ScaffoldFile[];
  assert.equal(relative(created!), "server/api/users/index.post.ts");
  assert.match(created!.content, /body: postUsersBody,/);
  assert.equal(added!.append, true);
  assert.equal(added!.content, "\nexport const postUsersBody = z.object({});\nexport const postUsersResponse = z.object({ ok: z.boolean() });\n");
  assert.match(endpointFiles(root, "GET", "/users/[id]", "valibot") as string, /ya exporta/);
});
