import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const viteRoot = fileURLToPath(new URL('../../../meeko/node_modules/vite', import.meta.url))
const cli = fileURLToPath(new URL('../../../meeko/dist/cli.js', import.meta.url))

/** The page with what `apps/ui` does not document yet: every test and the visual review read it. */
const showcase = `<script lang="ts">
	import { signal, trustHtml } from '@meekojs/meeko'
	import { withViewTransition } from '@meekojs/ui/runtime'

	const tab = signal<'account' | 'team' | 'billing' | 'audit'>('team')
	const tabs = [{ value: 'account', label: 'Cuenta' }, { value: 'team', label: 'Equipo' }, { value: 'billing', label: 'Facturación', disabled: true }, { value: 'audit', label: 'Auditoría' }] as const
	const second = signal('one')
	const changes = signal<string[]>([])

	interface Result { title: string; url: string; excerpt: string; sections?: Result[] }
	const pages: Result[] = [
		{ title: 'Señales', url: '#signals', excerpt: 'Estado <mark>reactivo</mark> sin ceremonia.', sections: [{ title: 'Derivadas', url: '#computed', excerpt: 'Valores que se recalculan solos.' }, { title: 'Efectos', url: '#effects', excerpt: 'Trabajo que sigue a una señal.' }] },
		{ title: 'Rutas', url: '#routes', excerpt: 'Archivos que son páginas.' },
	]
	const query = signal('')
	const active = signal(0)
	const paletteOpen = signal(false)
	const chosen = signal('')
	const events = signal<string[]>([])
	const results = signal<readonly Result[]>([])
	const status = signal<'idle' | 'loading' | 'ready' | 'empty' | 'unavailable'>('idle')
	effect(() => {
		const text = query.value.trim().toLowerCase()
		if (!text) {
			results.value = []
			status.value = 'idle'
		} else if (text === 'error') {
			results.value = []
			status.value = 'unavailable'
		} else {
			results.value = pages.filter((page) => page.title.toLowerCase().includes(text) || text === 'todo')
			status.value = results.value.length ? 'ready' : 'empty'
		}
	})
	const buttons = ['Copiar', 'Mover']
	const bold = trustHtml('<strong>Con formato</strong>')
	const fade = signal(false)
	const fadeTransition = () => withViewTransition(() => (fade.value = !fade.value))

	const plan = signal<string | null>('Equipo')
	const late = signal<string[]>(['Equipo'])
	const rich = [{ id: 1, name: 'Ana', color: 'violeta' }, { id: 2, name: 'Bea', color: 'cian', disabled: true }, { id: 3, name: 'Carla', color: 'rosa' }]
	const person = signal<(typeof rich)[number] | null>(rich[2]!)
	const selectOpen = signal(false)
</script>

<template>
	<main style="padding: 24px; display: grid; gap: 24px; max-width: 720px;">
		<UIThemeToggle id="theme" mode="select" />
		<section id="tabs">
			<UITabs model="tab" label="Ajustes" bind:items="tabs" on:change="(value) => (changes.value = [...changes.value, value])">
				<snippet name="panel-account"><p id="panel-account">Tu cuenta</p></snippet>
				<snippet name="panel-team"><p id="panel-team">Tu equipo</p></snippet>
				<snippet name="panel" params="item"><p bind:data-panel="item.value">Panel común: {item.label}</p></snippet>
			</UITabs>
			<p id="tab-value">{tab.value}|{changes.value.join()}</p>
			<button id="tab-external" type="button" on:click="() => (tab.value = 'audit')">Auditoría desde fuera</button>
		</section>
		<section id="tabs-two">
			<UITabs labelledBy="tab-title" model="second" bind:items="[{ value: 'one', label: 'Uno' }, { value: 'two', label: 'Dos' }]">
				<snippet name="panel" params="item">Contenido {item.label}</snippet>
			</UITabs>
			<h2 id="tab-title">Segundo grupo</h2>
		</section>
		<section id="tooltips" style="display: flex; gap: 48px; padding-top: 48px;">
			<UITooltip text="Se publica al guardar"><snippet name="trigger">¿Qué es esto?</snippet></UITooltip>
			<UITooltip placement="bottom" bind:delay="0">
				<snippet name="anchor" params="trigger"><button type="button" bind:id="trigger.id" bind:aria-describedby="trigger['aria-describedby']">Propio</button></snippet>
				<div html="bold" />
			</UITooltip>
		</section>
		<section id="palette">
			<UICommandPalette
				inputId="palette-input"
				inputName="q"
				model="paletteOpen"
				model:query="query"
				model:active="active"
				hrefBy="url"
				labelBy="title"
				childrenBy="sections"
				bind:results="results.value"
				bind:status="status.value"
				on:open="() => (events.value = [...events.value, 'open'])"
				on:close="() => (events.value = [...events.value, 'close'])"
				on:choose="(item) => (chosen.value = item.title)"
			>
				<snippet name="item" params="item, state"><strong>{item.title}</strong><span class="meeko-ui-command-excerpt" bind:data-depth="state.depth" html="trustHtml(item.excerpt)" /></snippet>
			</UICommandPalette>
			<UICommandPalette bind:trigger="false" bind:shortcut="false" label="Acciones" bind:results="buttons" status="ready" on:choose="(item) => (chosen.value = item)" model="selectOpen" />
			<button id="open-actions" type="button" on:click="() => (selectOpen.value = true)">Acciones</button>
			<p id="palette-out">{chosen.value}|{events.value.join()}|{active.value}</p>
		</section>
		<section id="selects" style="display: grid; gap: 12px;">
			<label for="plain">Plan</label>
			<UISelect id="plain" name="plain" placeholder="Elige" clearable model="plan" bind:options="late.value" />
			<button id="more" type="button" on:click="() => (late.value = ['Personal', 'Equipo', 'Empresa'])">Más opciones</button>
			<button id="none" type="button" on:click="() => (late.value = ['Personal'])">Quitar la elegida</button>
			<label for="rich">Persona</label>
			<UISelect id="rich" by="id" labelBy="name" placement="top-start" bind:offset="10" model="person" bind:options="rich">
				<snippet name="option" params="option, state"><span class="dot" bind:data-color="option.color" /><span>{option.name}</span><em if:when="state.selected"> (elegida)</em></snippet>
			</UISelect>
			<p id="select-out">{plan.value}|{person.value?.name}</p>
		</section>
	</main>
</template>
`

const route = "import { definePage } from '@meekojs/meeko/framework'\nexport const route = definePage({ render: 'prerender' })\n"

/** A throwaway application of its own, removed afterwards, that uses the built package. */
export async function createNativeApp(context) {
	const parent = fileURLToPath(new URL('../../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const root = await mkdtemp(join(parent, 'native-'))
	const links = { '@meekojs/ui': packageRoot, vite: viteRoot }
	const linkPaths = Object.keys(links).map((target) => join(root, 'node_modules', target))
	let stop = async () => {}
	// The links go first, so removing the application never walks into the packages.
	context.after(async () => {
		await stop()
		for (const link of linkPaths) await unlink(link).catch(() => undefined)
		await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
	})
	const config = { modules: ['@meekojs/ui'], theme: true, server: { adapter: 'static' } }
	const files = {
		'package.json': JSON.stringify({ name: 'native-fixture', private: true, type: 'module' }),
		'meeko.config.mjs': `export default ${JSON.stringify(config)}\n`,
		'app/app.meeko': '<template><UIApp><MeekoOutlet /></UIApp></template>\n',
		'app/pages/index.meeko': showcase,
		'app/pages/index.route.ts': route,
		'app/pages/other.meeko': '<template><main><h1 id="other">Otra página</h1><MeekoLink id="back" to="/">Volver</MeekoLink></main></template>\n',
		'app/pages/other.route.ts': route,
	}
	for (const [file, source] of Object.entries(files)) {
		await mkdir(dirname(join(root, file)), { recursive: true })
		await writeFile(join(root, file), source)
	}
	for (const [target, source] of Object.entries(links)) {
		await mkdir(dirname(join(root, 'node_modules', target)), { recursive: true })
		await symlink(source, join(root, 'node_modules', target), 'junction')
	}
	const free = async () => {
		const server = createServer().listen(0, '127.0.0.1')
		await new Promise((done) => server.once('listening', done))
		const { port } = server.address()
		await new Promise((done) => server.close(done))
		return port
	}
	const httpPort = process.env.MEEKO_FIXTURE_PORT ?? (await free())
	const server = spawn(process.execPath, [cli, 'dev', root], { cwd: root, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192', PORT: String(httpPort), MEEKO_HMR_PORT: String(await free()), MEEKO_EDITOR_BRIDGE: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
	stop = async () => {
		if (server.exitCode !== null) return
		const exited = new Promise((done) => server.once('exit', done))
		server.kill()
		await exited
	}
	let logs = ''
	server.stdout.on('data', (chunk) => (logs += chunk))
	server.stderr.on('data', (chunk) => (logs += chunk))
	const origin = `http://127.0.0.1:${httpPort}`
	const started = Date.now()
	while (true) {
		if (server.exitCode !== null || Date.now() - started > 60_000) throw new Error(logs)
		try {
			if ((await fetch(origin)).ok) break
		} catch {
			/* Server is starting. */
		}
		await new Promise((done) => setTimeout(done, 100))
	}
	return { origin, root, logs: () => logs }
}
