import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const formsPage = `<script lang="ts">
import { signal } from '@meekojs/meeko'
import { useToast } from '@meekojs/ui/runtime'
const comment = signal('Initial comment')
const accepted = signal(false)
const notifications = signal(true)
const period = signal('day')
const volume = signal(4)
const busy = signal(false)
const toast = useToast()
</script>
<template>
<main id="contenido" style="max-width:var(--ui-container-sm);margin:var(--ui-space-6) auto;padding:var(--ui-space-4);display:grid;gap:var(--ui-space-5)">
<h1>Formularios y estados</h1>
<form id="editor" on:submit="(event) => event.preventDefault()" style="display:grid;gap:var(--ui-space-4)">
<UIField id="comment" label="Comentario" hint="Ayuda del campo" bind:counter="comment.value.length + '/200'"><snippet name="default" params="id, describedBy"><UITextarea bind:id="id" bind:describedBy="describedBy" name="comment" bind:maxlength="200" model="comment" /></snippet></UIField>
<UIInput aria-label="Fecha" name="date" type="date" min="2026-01-01" max="2026-12-31" />
<UICheckbox label="Aceptar condiciones" name="accepted" value="yes" model="accepted" />
<UISwitch label="Notificaciones" name="notifications" model="notifications" />
<UIRadioGroup legend="Periodo" name="period" variant="segmented" model="period" bind:options="[{value:'day',label:'Día'},{value:'week',label:'Semana'},{value:'month',label:'Mes',disabled:true}]" />
<UISlider label="Volumen" name="volume" bind:min="0" bind:max="10" bind:step="2" model="volume" />
<output id="values">{comment.value}|{accepted.value}|{notifications.value}|{period.value}|{volume.value}</output>
<UIButton id="save" type="submit" name="intent" value="save" form="editor" tone="danger" bind:loading="busy.value">Guardar cambios</UIButton>
<UIButton id="busy" on:click="() => (busy.value = !busy.value)">Cambiar carga</UIButton>
</form>
<UIAlert title="No se pudo guardar" description="Comprueba la conexión y vuelve a intentarlo." tone="danger" bind:dismiss="true"><snippet name="actions"><UIButton variant="outline">Reintentar</UIButton></snippet></UIAlert>
<UIAlert title="Traducción pendiente" description="Se muestra el contenido original." tone="info" />
<div style="display:flex;gap:var(--ui-space-2)"><UIBadge tone="info" bind:dot="true">Información</UIBadge><UIBadge tone="success" bind:dot="true">Publicado</UIBadge><UIBadge tone="warning" bind:dot="true">Pendiente</UIBadge></div>
<UICard title="Resumen" density="compact" padding="md"><UIStat label="Visitas" bind:value="1200" detail="Esta semana" /></UICard>
<UIDescriptionList bind:columns="2" bind:items="[{label:'Estado',value:'Activo'},{label:'Actualizado',value:'Hoy'}]" />
<UITable caption="Resultados" density="compact" rowKey="id" bind:rows="[{id:1,name:'Ana',count:5}]" bind:columns="[{key:'name',label:'Nombre',rowHeader:true},{key:'count',label:'Cantidad',numeric:true}]" />
<UIEmpty title="Sin resultados" description="Añade un elemento para comenzar." variant="panel"><snippet name="actions"><UIButton variant="outline">Añadir elemento</UIButton></snippet></UIEmpty>
<UISkeleton bind:lines="3" bind:widths="['full','long','short']" />
<UIButton id="notify" on:click="() => toast.add({text:'Cambios guardados',tone:'success',duration:0})">Mostrar aviso</UIButton>
<UIButton id="timed" on:click="() => toast.add({text:'Aviso temporal',duration:800})">Aviso temporal</UIButton>
<UIButton id="clear" on:click="() => toast.clear()">Limpiar avisos</UIButton>
</main>
</template>`

/** Isolated consumer, no edits to apps/ui. All resources are released by the caller's context. */
export async function startForms(context, { port = 4568, timeout = 120_000 } = {}) {
	const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
	const parent = join(packageRoot, '.meeko')
	await mkdir(parent, { recursive: true })
	const root = await mkdtemp(join(parent, 'd1-forms-'))
	const link = join(root, 'node_modules', '@meekojs', 'ui')
	const resources = {}
	context.after(async () => {
		const server = resources.server
		if (server && server.exitCode === null && server.signalCode === null) {
			const closed = once(server, 'close')
			if (process.platform === 'win32') {
				try {
					execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
				} catch {
					server.kill('SIGKILL')
				}
			} else server.kill('SIGKILL')
			await closed
		}
		await unlink(link).catch(() => undefined)
		await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
	})
	const files = {
		'package.json': JSON.stringify({ name: 'ui-forms-test', private: true, type: 'module' }),
		'meeko.config.ts': `import { defineMeekoConfig } from '@meekojs/meeko/framework'\nexport default defineMeekoConfig({ modules: ['@meekojs/ui'] })\n`,
		'app/app.meeko': '<template><UIApp><MeekoOutlet /></UIApp></template>',
		'app/pages/index.meeko': formsPage,
	}
	for (const [file, source] of Object.entries(files)) {
		await mkdir(dirname(join(root, file)), { recursive: true })
		await writeFile(join(root, file), source)
	}
	await mkdir(dirname(link), { recursive: true })
	await symlink(packageRoot, link, 'junction')
	const cli = fileURLToPath(new URL('../../../meeko/dist/cli.js', import.meta.url))
	const server = spawn(process.execPath, [cli, 'dev', root], { cwd: root, timeout, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192', PORT: String(port), MEEKO_HMR_PORT: String(port + 1), MEEKO_EDITOR_BRIDGE: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

	resources.server = server
	let logs = ''
	server.stdout.on('data', (chunk) => {
		logs += chunk
	})
	server.stderr.on('data', (chunk) => {
		logs += chunk
	})
	const origin = `http://127.0.0.1:${port}`
	const started = Date.now()
	while (true) {
		if (server.exitCode !== null || Date.now() - started > 40_000) throw new Error(logs)
		try {
			if ((await fetch(origin)).ok) break
		} catch {
			/* Starting. */
		}
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	return { origin, root, server }
}
