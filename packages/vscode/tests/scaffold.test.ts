import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import type { ScaffoldFile } from '../src/scaffold'

import { clickedFolder, componentFile, endpointFiles, indentUnit, pageFile, projectRootOf, scaffoldPrefill, schemaLibrary, takenFile, writtenContent } from '../src/scaffold'

let root: string

before(async () => {
	root = await mkdtemp(join(tmpdir(), 'meeko-scaffold-'))
	await mkdir(join(root, 'app', 'pages'), { recursive: true })
	await mkdir(join(root, 'app', 'components', 'App'), { recursive: true })
	await mkdir(join(root, 'shared', 'schemas'), { recursive: true })
	await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { valibot: '^1.0.0' } }))
})

after(async () => {
	await rm(root, { recursive: true, force: true })
})

const relative = (file: ScaffoldFile | string): string => {
	assert.ok(typeof file !== 'string', String(file))
	return file.path.slice(root.length + 1).replaceAll('\\', '/')
}

test('the project is the nearest folder with app/pages or meeko.config', () => {
	assert.equal(projectRootOf(join(root, 'app', 'components', 'App')), root)
	assert.equal(schemaLibrary(root), 'valibot')
})

test('components go into the folder their name starts with, as autoimports name them', () => {
	assert.equal(relative(componentFile(root, 'AppCard')), 'app/components/App/Card.meeko')
	assert.equal(relative(componentFile(root, 'UiBadge')), 'app/components/UiBadge.meeko')
	assert.equal(relative(componentFile(root, 'Ui/Badge')), 'app/components/Ui/Badge.meeko')
	assert.equal((componentFile(root, 'AppCard', '\t') as ScaffoldFile).content, '<template>\n\t<div></div>\n</template>\n')
	assert.match(componentFile(root, 'app-card') as string, /PascalCase/)
})

test('pages follow the route: a static segment gets index.meeko, a parameter its own file', () => {
	assert.equal(relative(pageFile(root, '/')), 'app/pages/index.meeko')
	assert.equal(relative(pageFile(root, '/users')), 'app/pages/users/index.meeko')
	assert.equal(relative(pageFile(root, '/users/[id]')), 'app/pages/users/[id].meeko')
	assert.match((pageFile(root, '/users/[id]') as ScaffoldFile).content, /useHead\(\{ title: "Id" \}\)/)
	assert.match(pageFile(root, 'users') as string, /starts with \//)
	assert.match(pageFile(root, '/Users') as string, /is not a valid segment/)
})

test("an endpoint comes with its public schemas, added to the resource's schema file", async () => {
	const [endpoint, schemas] = endpointFiles(root, 'GET', '/api/users/[id]', 'valibot') as ScaffoldFile[]
	assert.equal(relative(endpoint!), 'server/api/users/[id].get.ts')
	assert.equal(
		endpoint!.content,
		`import { defineApiRoute } from "@meekojs/meeko/server";
import { getUsersByIdParams, getUsersByIdResponse } from "../../../shared/schemas/users.js";

export default defineApiRoute({
  params: getUsersByIdParams,
  response: getUsersByIdResponse,
  handler: () => ({ ok: true }),
});
`,
	)
	assert.equal(relative(schemas!), 'shared/schemas/users.ts')
	assert.equal(schemas!.append, undefined)
	assert.equal(
		schemas!.content,
		`import * as v from "valibot";

export const getUsersByIdParams = v.object({ id: v.string() });
export const getUsersByIdResponse = v.object({ ok: v.boolean() });
`,
	)
	await writeFile(schemas!.path, schemas!.content)
	const [created, added] = endpointFiles(root, 'POST', '/users', 'zod') as ScaffoldFile[]
	assert.equal(relative(created!), 'server/api/users/index.post.ts')
	assert.match(created!.content, /body: postUsersBody,/)
	assert.equal(added!.append, true)
	assert.equal(added!.content, '\nexport const postUsersBody = z.object({});\nexport const postUsersResponse = z.object({ ok: z.boolean() });\n')
	assert.match(endpointFiles(root, 'GET', '/users/[id]', 'valibot') as string, /already exports/)
})

test('a click in the explorer acts on the folder, or on the folder of the clicked file', async () => {
	const users = join(root, 'app', 'pages', 'users')
	await mkdir(users, { recursive: true })
	await writeFile(join(users, 'index.meeko'), '<template></template>\n')
	assert.equal(clickedFolder(users), users)
	assert.equal(clickedFolder(join(users, 'index.meeko')), users)
	assert.equal(clickedFolder(join(users, 'missing.meeko')), users)
	assert.equal(projectRootOf(clickedFolder(join(users, 'index.meeko'))), root)
})

test('the clicked folder prefills the route of a page or an endpoint', () => {
	assert.equal(scaffoldPrefill('page', root, join(root, 'app', 'pages', 'users')), '/users/')
	assert.equal(scaffoldPrefill('page', root, join(root, 'app', 'pages', 'users', '[id]')), '/users/[id]/')
	assert.equal(scaffoldPrefill('page', root, join(root, 'app', 'pages')), '/')
	assert.equal(scaffoldPrefill('endpoint', root, join(root, 'server', 'api', 'users', '[id]')), '/users/[id]/')
	assert.equal(scaffoldPrefill('endpoint', root, join(root, 'server', 'api')), '/')
	// The prefilled route completes into a file of the clicked folder.
	const users = scaffoldPrefill('page', root, join(root, 'app', 'pages', 'users'))!
	assert.equal(relative(pageFile(root, `${users}[id]`)), 'app/pages/users/[id].meeko')
	assert.equal(relative(pageFile(root, users)), 'app/pages/users/index.meeko')
})

test('the clicked folder prefills the path of a component', () => {
	assert.equal(scaffoldPrefill('component', root, join(root, 'app', 'components', 'App')), 'App/')
	assert.equal(scaffoldPrefill('component', root, join(root, 'app', 'components', 'App', 'Forms')), 'App/Forms/')
	assert.equal(relative(componentFile(root, `${scaffoldPrefill('component', root, join(root, 'app', 'components', 'App'))}Card`)), 'app/components/App/Card.meeko')
	// app/components itself: a bare name already lands there.
	assert.equal(scaffoldPrefill('component', root, join(root, 'app', 'components')), undefined)
})

test('folders of another kind, outside the project or with unusable names prefill nothing', () => {
	assert.equal(scaffoldPrefill('page', root, join(root, 'app', 'components', 'App')), undefined)
	assert.equal(scaffoldPrefill('endpoint', root, join(root, 'app', 'pages', 'users')), undefined)
	assert.equal(scaffoldPrefill('component', root, join(root, 'app', 'pages', 'users')), undefined)
	assert.equal(scaffoldPrefill('page', root, root), undefined)
	assert.equal(scaffoldPrefill('page', root, join(root, 'app')), undefined)
	assert.equal(scaffoldPrefill('page', root, join(root, 'app', 'pages-old')), undefined)
	assert.equal(scaffoldPrefill('page', root, join(root, 'app', 'pages', 'Users')), undefined)
	assert.equal(scaffoldPrefill('page', root, join(root, 'app', 'pages', '..hidden')), undefined)
	assert.equal(scaffoldPrefill('component', root, join(root, 'app', 'components', 'ui')), undefined)
})

test('generated files indent with a tab or with the configured spaces', () => {
	assert.equal(indentUnit(false, 4), '\t')
	assert.equal(indentUnit(true, 2), '  ')
	assert.equal(indentUnit(true, 4), '    ')
})

test('an existing file blocks the scaffold unless the content is appended to it', () => {
	const created: ScaffoldFile = { path: '/project/a.ts', content: 'a' }
	const added: ScaffoldFile = { path: '/project/schemas.ts', content: 'b', append: true }
	const exists = (path: string) => path !== '/project/free.ts'
	assert.equal(takenFile([created, added], exists), created)
	assert.equal(takenFile([added], exists), undefined)
	assert.equal(takenFile([{ path: '/project/free.ts', content: '' }, added], exists), undefined)
	assert.equal(takenFile([]), undefined)
	// The default check reads the disk.
	assert.equal(takenFile([{ path: join(root, 'package.json'), content: '' }])?.path, join(root, 'package.json'))
	assert.equal(takenFile([{ path: join(root, 'nothing-here.ts'), content: '' }]), undefined)
})

test('appended content goes after what the file had; a new file ignores it', () => {
	assert.equal(writtenContent({ path: 'schemas.ts', content: '\nexport const b = 1;\n', append: true }, 'export const a = 1;\n'), 'export const a = 1;\n\nexport const b = 1;\n')
	assert.equal(writtenContent({ path: 'new.ts', content: 'fresh\n' }, 'stale'), 'fresh\n')
})
