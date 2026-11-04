import { fileURLToPath } from 'node:url'

import { startDevServer } from '../../../../scripts/test-support/dev-server.ts'
import { createFixture } from '../../../../scripts/test-support/fixture.ts'

const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const viteRoot = fileURLToPath(new URL('../../../meeko/node_modules/vite', import.meta.url))
const cli = fileURLToPath(new URL('../../../meeko/dist/cli.js', import.meta.url))

/** The page with what `apps/ui` does not document yet: every test and the visual review read it. */
const showcase = `<script lang="ts">
	import { signal, trustHtml, useElementRef } from '@meekojs/meeko'
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
	const exposedPalette = useElementRef('exposedPalette')
	const drawer = signal(false)
	const drawerCloses = signal(0)
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
			<UICommandPalette ref:exposedPalette bind:trigger="false" bind:shortcut="false" label="Expuesta" bind:results="buttons" status="ready" />
			<button id="show-exposed" type="button" on:click="() => exposedPalette.value?.show()">Expuesta</button>
			<p id="palette-out">{chosen.value}|{events.value.join()}|{active.value}</p>
		</section>
		<section id="drawers">
			<UIDrawer title="Panel" triggerLabel="Abrir panel" model="drawer" on:close="() => (drawerCloses.value += 1)"><p>Contenido</p><MeekoLink id="drawer-link" to="/route-a">A otra ruta</MeekoLink></UIDrawer>
			<UIDrawer title="Panel derecho" side="end" triggerLabel="Abrir el derecho" closedBy="none"><p>Contenido</p></UIDrawer>
			<p id="drawer-out">{String(drawer.value)}|{drawerCloses.value}</p>
			<MeekoLink id="to-tabs" to="/route-a">Pestañas por ruta</MeekoLink>
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

/** A throwaway application of its own, removed afterwards, that uses the built package. `extraFiles` adds pages of a test. */
export async function createNativeApp(context, extraFiles = {}) {
	const parent = fileURLToPath(new URL('../../.meeko/', import.meta.url))
	const links = { '@meekojs/ui': packageRoot, vite: viteRoot }
	const config = { modules: ['@meekojs/ui'], theme: true, viewTransitions: true, server: { adapter: 'static' } }
	const files = {
		'package.json': JSON.stringify({ name: 'native-fixture', private: true, type: 'module' }),
		'meeko.config.mjs': `export default ${JSON.stringify(config)}\n`,
		'app/app.meeko': '<template><UIApp><MeekoOutlet /></UIApp></template>\n',
		'app/pages/index.meeko': showcase,
		'app/pages/index.route.ts': route,
		'app/pages/other.meeko': '<template><main><h1 id="other">Otra página</h1><MeekoLink id="back" to="/">Volver</MeekoLink></main></template>\n',
		'app/pages/other.route.ts': route,
		// Each page mounts its own tabs: the indicator can only move with the transition of the navigation.
		'app/pages/route-a.meeko': `<template><main><UINavigationTabs label="Rutas" bind:items="[{ label: 'Primera pestaña', to: '/route-a' }, { label: 'Segunda', to: '/route-b' }]" /><h1 id="route-a">A</h1></main></template>\n`,
		'app/pages/route-a.route.ts': route,
		'app/pages/route-b.meeko': `<template><main><UINavigationTabs label="Rutas" bind:items="[{ label: 'Primera pestaña', to: '/route-a' }, { label: 'Segunda', to: '/route-b' }]" /><h1 id="route-b">B</h1></main></template>\n`,
		'app/pages/route-b.route.ts': route,
		...extraFiles,
	}
	const fixture = await createFixture(context, parent, 'native-', { files, links })
	const { root } = fixture
	const { origin, logs, stop } = await startDevServer({ root, cli, port: process.env.MEEKO_FIXTURE_PORT ? Number(process.env.MEEKO_FIXTURE_PORT) : undefined })
	fixture.setStop(stop)
	return { origin, root, logs }
}
