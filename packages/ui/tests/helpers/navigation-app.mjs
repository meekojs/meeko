import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const i18nRoot = fileURLToPath(new URL('../../../i18n', import.meta.url))
const viteRoot = fileURLToPath(new URL('../../../meeko/node_modules/vite', import.meta.url))
export const cli = fileURLToPath(new URL('../../../meeko/dist/cli.js', import.meta.url))

/** What must stop before an application can be removed: Windows does not delete a folder in use. */
const stops = new Map()

const route = (options = '') => `import { definePage } from '@meekojs/meeko/framework'\nexport const route = definePage({ render: 'prerender'${options} })\n`

/** The page that uses every navigation component: the SSR tests, the e2e tests and the visual review read it. */
const showcase = `<script lang="ts">
	import { signal, trustHtml } from '@meekojs/meeko'

	const filter = signal('Todas')
	const brand = { name: 'Meeko', product: 'UI', to: '/', image: { src: '/logo.svg', width: 24, height: 24 }, ariaLabel: 'Meeko UI: inicio' } as const
	const items = [
		{ label: 'Inicio', to: '/' },
		{ label: 'Acerca de', to: '/about' },
		{ label: 'Usuario', to: '/users/[id]', params: { id: '7' }, search: { tab: 'a' } },
		{ label: 'GitHub', href: 'https://github.com/meekojs/meeko', target: '_blank' },
	] as const
	const groups = [
		{ title: 'Empezar', icon: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h7', items: [{ label: 'Inicio', href: '/home' }, { label: 'Acerca de', to: '/about', featured: true }] },
		{ title: 'Referencia', open: false, items: [{ label: 'useSignal', href: '/reference/use-signal', code: true }, { label: 'useMuyLargoConUnNombreQueNoCabeEnLaColumna', href: '/reference/long', code: true }] },
		{ title: 'Sólo aquí', open: false, items: [{ label: 'Actual', href: '/current-page' }] },
	] as const
	const footerGroups = [
		{ title: 'Recursos', items: [{ label: 'Guía', to: '/about' }, { label: 'Referencia', href: '/reference' }] },
		{ title: 'Comunidad', items: [{ label: 'GitHub', href: 'https://github.com/meekojs/meeko' }] },
	] as const
	const toc = [
		{ id: 'uno', text: 'Primera sección', level: 2 },
		{ id: 'dos', text: 'Segunda sección', level: 2 },
		{ id: 'dos-a', text: 'Un apartado', level: 3 },
		{ id: 'tres', text: 'Tercera sección', level: 2 },
	]
	const locales = [
		{ code: 'es', label: 'Español', href: '/', current: true },
		{ code: 'en', label: 'English', href: '/en' },
	]
	const crumbs = [{ label: 'Inicio', to: '/' }, { label: 'Referencia', href: '/reference' }, { label: 'useSignal' }] as const
	const highlighted = trustHtml('<pre class="shiki" tabindex="0"><code><span style="--shiki-light:#a626a4;--shiki-dark:#c678dd">const</span> a = 1</code></pre>')
	const snapshot = trustHtml('<h2 id="s">Del snapshot<a class="heading-anchor" href="#s" aria-label="Enlace" data-pagefind-ignore>#</a></h2><p>Texto con <a href="/about">enlace</a> y <code>código</code>.</p><ul><li>Uno</li><li>Dos</li></ul><div class="table-wrap"><table><thead><tr><th>Prop</th><th>Tipo</th></tr></thead><tbody><tr><td><code>to</code></td><td>Ruta</td></tr></tbody></table></div><div class="callout callout-warning"><p class="callout-title"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8" /></svg>Atención</p><p>Con cuidado.</p></div><div class="code-block" data-lang="ts" data-verdict="good"><div class="code-head" data-pagefind-ignore><span class="code-verdict"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>Correcto</span><span class="code-lang">ts</span><button type="button" class="code-copy" data-copy>Copiar</button></div><pre class="shiki" tabindex="0"><code>const del = 2</code></pre></div>')
	const diff = '--- a/guia.md\\n+++ b/guia.md\\n@@ -1,2 +1,2 @@\\n contexto\\n-antes\\n+después\\n'

	const tabsCurrent = signal('/one')
	const forced = signal(true)
	const drawerOpen = signal(false)
	const closes = signal(0)
	const shown = signal(2)
	const busy = signal(false)
	const stays = signal(0)
	const showSuggestion = signal(false)

	function loadMore() {
		busy.value = true
		setTimeout(() => {
			shown.value += 1
			busy.value = false
		}, 800)
	}
</script>

<template>
	<UIPage layout="docs">
		<snippet name="header">
			<UIHeader bind:brand="brand" bind:items="items" current="/">
				<snippet name="actions"><UILocaleSwitcher bind:items="locales" /></snippet>
			</UIHeader>
		</snippet>
		<snippet name="notices"><UIAlert tone="info" description="Aviso de la página" /></snippet>
		<snippet name="bar">
			<UIDrawer id="menu" title="Contenidos" triggerLabel="Contenidos" model="drawerOpen" on:close="() => closes.value++">
				<UINavigationTree bind:groups="groups" label="Contenidos" />
				<snippet name="footer"><span>Pie</span></snippet>
			</UIDrawer>
		</snippet>
		<snippet name="sidebar"><UINavigationTree bind:groups="groups" current="/current-page" label="Documentación" /></snippet>
		<snippet name="aside"><UITableOfContents bind:entries="toc" /></snippet>
		<UITableOfContents bind:entries="toc" variant="collapsible" />
		<UIPageHeader title="Navegación" description="Todos los componentes de navegación juntos.">
			<snippet name="breadcrumb"><UIBreadcrumb bind:items="crumbs" /></snippet>
			<snippet name="actions"><UIButton variant="outline" size="sm">Editar</UIButton></snippet>
		</UIPageHeader>
		<h2 id="uno">Primera sección</h2>
		<UINavigationTabs bind:items="[{ label: 'Uno', href: '#one', current: tabsCurrent.value === '/one' }, { label: 'Dos más largo', href: '#two', current: tabsCurrent.value === '/two' }, { label: 'Tres', to: '/about' }, { label: 'Hijos', to: '/users/[id]', params: { id: '7' }, match: 'prefix' }, { label: 'Cuarto enlace al final', href: '#four', current: tabsCurrent.value === '/four' }]" label="Vistas" />
		<button type="button" id="tab-two" on:click="() => (tabsCurrent.value = '/two')">Tab dos</button>
		<button type="button" id="tab-four" on:click="() => (tabsCurrent.value = '/four')">Tab cuatro</button>
		<UINavigationTabs bind:items="[{ label: 'Forzado', to: '/about', current: forced.value }, { label: 'Quitado', to: '/', current: false }, { label: 'Según la ruta', to: '/' }, { label: 'Otra ruta', to: '/about' }]" label="Estados" />
		<UINavigationTabs variant="segmented" label="Filtro" bind:items="[{ label: 'Todas', href: '#todas', current: filter.value === 'Todas', badge: '3' }, { label: 'Activas', href: '#activas', current: filter.value === 'Activas', badge: '2', badgeTone: 'success', badgeDot: true }]" on:select="(event, item) => { event.preventDefault(); filter.value = item.label }" />
		<button type="button" id="toggle-forced" on:click="() => (forced.value = !forced.value)">Forzar</button>
		<button type="button" id="open-drawer" on:click="() => (drawerOpen.value = true)">Abrir panel</button>
		<output id="drawer-state">{drawerOpen.value ? 'abierto' : 'cerrado'}:{closes.value}</output>
		<UIPagination bind:shown="shown.value" bind:total="5" bind:busy="busy.value" on:loadMore="loadMore" />
		<UIPagination bind:total="1200" bind:hasMore="true" bind:moreLink="{ to: '/about' }" loadMoreLabel="Siguiente tanda" />
		<section class="tall"><h2 id="dos">Segunda sección</h2><h3 id="dos-a">Un apartado</h3></section>
		<UICodeBlock code="pnpm add @meekojs/ui" lang="sh" label="Instalación" labelLang="es" uiLang="es" copyAriaLabel="Copiar el comando" />
		<UICodeBlock code="const a = 1" bind:html="highlighted" lang="ts" verdict="good" />
		<UICodeBlock code="const a = b" lang="ts" verdict="bad" />
		<UICodeBlock bind:code="'[info] build\\n[warn] lento'" mode="log" label="Salida" textLang="en" />
		<UIDiff bind:diff="diff" label="Cambios en la guía" />
		<UIDiff diff="" label="Sin cambios" />
		<UIProse as="article" id="snapshot" bind:html="snapshot" />
		<UIProse id="handwritten"><h2>A mano</h2><p>Con marcado propio.</p><UICard title="Dentro del texto" variant="solid"><p>Texto de la card.</p></UICard></UIProse>
		<section class="tall"><h2 id="tres">Tercera sección</h2></section>
		<UIPageNavigation bind:previous="{ label: 'Inicio', to: '/' }" bind:next="{ label: 'Acerca de', to: '/about' }" />
		<button type="button" id="suggest" on:click="() => (showSuggestion.value = true)">Sugerir</button>
		<output id="stays">{stays.value}</output>
		<UILocaleSuggestion if:when="showSuggestion.value" bind:items="locales" on:stay="() => { stays.value++; showSuggestion.value = false }" />
		<snippet name="footer">
			<UIFooter bind:brand="brand" description="Componentes tipados para Meeko." bind:groups="footerGroups" bind:items="[{ label: 'Licencia', href: '/license' }]">
				<snippet name="legal">MIT</snippet>
			</UIFooter>
		</snippet>
	</UIPage>
</template>

<style>
	.tall {
		min-height: 110vh;
	}
</style>
`

const dashboard = `<template>
	<UIPage layout="dashboard" lang="es" mainId="principal" mainLang="en" skipLabel="Ir al panel">
		<UIPageHeader layout="dashboard" title="Panel" />
		<UILocaleSwitcher bind:items="[{ code: 'es', label: 'Español', href: '/' }]" />
		<UIPageNavigation />
		<UINavigationTree bind:groups="[]" />
		<UITableOfContents bind:entries="[]" />
	</UIPage>
</template>
`

const landing = `<template>
	<UIPage layout="landing">
		<snippet name="header"><UIHeader bind:brand="{ name: 'Meeko', href: '/', compact: true, ariaLabel: 'Meeko, inicio' }" /></snippet>
		<UIPageHeader layout="landing" title="Portada" description="Una portada." />
		<UINavigationTree bind:groups="[{ items: [{ label: 'Suelto', href: '/x' }] }]" bind:collapsible="false" emptyText="Nada" />
	</UIPage>
</template>
`

/** Writes the application under packages/ui/.meeko and links the packages it needs; everything goes away with the test. */
export async function createNavigationApp(context) {
	const parent = join(packageRoot, '.meeko')
	await mkdir(parent, { recursive: true })
	const root = await mkdtemp(join(parent, 'navigation-'))
	const links = { '@meekojs/ui': packageRoot, '@meekojs/i18n': i18nRoot, vite: viteRoot }
	const linkPaths = Object.keys(links).map((target) => join(root, 'node_modules', target))
	// The links go first, so removing the application never walks into the packages.
	context.after(async () => {
		await stops.get(root)?.()
		for (const link of linkPaths) await unlink(link).catch(() => undefined)
		await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
	})
	const config = { modules: ['@meekojs/ui', '@meekojs/i18n'], theme: true, i18n: { defaultLocale: 'es', catalogs: { es: 'app/locales/es.json', en: 'app/locales/en.json' } }, server: { adapter: 'static' } }
	const files = {
		'package.json': JSON.stringify({ name: 'navigation-fixture', private: true, type: 'module' }),
		'meeko.config.mjs': `export default ${JSON.stringify(config)}\n`,
		'public/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>',
		'app/app.meeko': '<template><UIApp><MeekoOutlet /></UIApp></template>\n',
		'app/pages/index.meeko': showcase,
		'app/pages/index.route.ts': route(),
		'app/pages/dashboard.meeko': dashboard,
		'app/pages/dashboard.route.ts': route(),
		'app/pages/landing.meeko': landing,
		'app/pages/landing.route.ts': route(),
		'app/pages/dashboard/child.meeko': `<template><UINavigationTabs bind:items="[{ label: 'Panel', to: '/dashboard', match: 'prefix' }, { label: 'Otro', to: '/about' }]" /></template>
`,
		'app/pages/dashboard/child.route.ts': route(),
		'app/pages/aside.meeko': `<script lang="ts">
	const shown = signal(true)
	const text = 'Un párrafo largo que ocupa varias líneas para que su corte cambie si cambia el ancho de la columna. '.repeat(40)
</script>
<template>
	<UIPage>
		<snippet
			if:when="shown.value"
			name="aside"
		>
			<p id="aside-content">Índice</p>
		</snippet>
		<p id="long-text">{text}</p>
		<button
			id="toggle-aside"
			on:click="() => (shown.value = !shown.value)"
		>
			Alternar
		</button>
	</UIPage>
</template>
`,
		'app/pages/aside.route.ts': route(),
		'app/pages/about.meeko': '<template><p id="about">About</p></template>\n',
		'app/pages/about.route.ts': route(),
		'app/pages/users/[id].meeko': '<template><p>User</p></template>\n',
		'app/pages/users/[id].route.ts': route(", prerenderEntries: [{ id: '7' }]"),
		'app/locales/es.json': '{"hello":"Hola"}',
		'app/locales/en.json': '{"hello":"Hello"}',
	}
	for (const [file, source] of Object.entries(files)) {
		await mkdir(dirname(join(root, file)), { recursive: true })
		await writeFile(join(root, file), source)
	}
	for (const [target, source] of Object.entries(links)) {
		await mkdir(dirname(join(root, 'node_modules', target)), { recursive: true })
		await symlink(source, join(root, 'node_modules', target), 'junction')
	}
	return root
}

async function freePort() {
	const server = createServer().listen(0, '127.0.0.1')
	await new Promise((done) => server.once('listening', done))
	const { port } = server.address()
	await new Promise((done) => server.close(done))
	return port
}

/** `meeko dev` on the application. MEEKO_FIXTURE_PORT fixes the port, for a visual review by hand. */
export async function serveNavigationApp(root) {
	const httpPort = process.env.MEEKO_FIXTURE_PORT ?? (await freePort())
	const server = spawn(process.execPath, [cli, 'dev', root], { cwd: root, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192', PORT: String(httpPort), MEEKO_HMR_PORT: String(await freePort()), MEEKO_EDITOR_BRIDGE: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
	stops.set(root, async () => {
		if (server.exitCode !== null) return
		const exited = new Promise((done) => server.once('exit', done))
		server.kill()
		await exited
	})
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
	return { origin, logs: () => logs }
}
