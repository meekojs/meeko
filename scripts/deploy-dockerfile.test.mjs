import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const readManifest = (directory) => JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))

/** Los proyectos con `package.json` de un grupo del workspace (`apps` o `packages`). */
function projectsIn(group) {
	return readdirSync(join(root, group))
		.map((name) => join(root, group, name))
		.filter((directory) => existsSync(join(directory, 'package.json')))
}

/** Los paquetes de `modules` en `meeko.config.ts`, sin subrutas: `@meekojs/ui/editor` es `@meekojs/ui`. */
function configuredModules(app) {
	const config = readFileSync(join(app, 'meeko.config.ts'), 'utf8')
	const list = /\bmodules:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? ''
	return [...list.matchAll(/['"]([^'"]+)['"]/g)].map(([, specifier]) =>
		specifier
			.split('/')
			.slice(0, specifier.startsWith('@') ? 2 : 1)
			.join('/'),
	)
}

/** Los paquetes del workspace, con su manifiesto, por nombre. */
const workspace = new Map(projectsIn('packages').map((directory) => [readManifest(directory).name, readManifest(directory)]))

/** Lo que una app necesita construido: sus `modules` y sus dependencias del workspace, transitivas. */
function packagesToBuild(app) {
	const required = new Set()
	const manifest = readManifest(app)
	const pending = [...configuredModules(app), ...Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })]
	while (pending.length > 0) {
		const name = pending.pop()
		const dependency = workspace.get(name)
		if (!dependency || required.has(name)) continue
		required.add(name)
		pending.push(...Object.keys({ ...dependency.dependencies, ...dependency.peerDependencies }))
	}
	return [...required].filter((name) => workspace.get(name).scripts?.build)
}

/** Los `--filter` de la orden que construye los paquetes en el paso `workspace` de `deploy/Dockerfile`. */
function dockerfileFilters() {
	const dockerfile = readFileSync(join(root, 'deploy', 'Dockerfile'), 'utf8')
	const command = /^RUN pnpm -r (--filter .*) run build$/m.exec(dockerfile)?.[1]
	assert.ok(command, 'deploy/Dockerfile ya no construye los paquetes con `pnpm -r --filter … run build`: revisa esta prueba')
	return new Set([...command.matchAll(/--filter\s+(\S+)/g)].map(([, name]) => name))
}

/**
 * `meeko build` carga cada módulo desde su `dist`, que la imagen no copia: `**\/dist` está fuera del
 * contexto. Un paquete que falta en los filtros solo se descubre al construir la imagen en el pipeline.
 */
test('deploy/Dockerfile construye todos los paquetes del workspace que cargan o necesitan las apps', () => {
	const filters = dockerfileFilters()
	const apps = projectsIn('apps').filter((directory) => existsSync(join(directory, 'meeko.config.ts')))
	assert.ok(apps.length > 0, 'el recorrido no encontró ninguna app: revisa la prueba')
	for (const app of apps) {
		const required = packagesToBuild(app)
		assert.ok(required.includes('@meekojs/meeko'), `${readManifest(app).name}: el recorrido no encontró el núcleo: revisa la prueba`)
		const missing = required.filter((name) => !filters.has(name))
		assert.deepEqual(missing, [], `${readManifest(app).name} necesita estos paquetes construidos, y faltan en los filtros de deploy/Dockerfile`)
	}
})
