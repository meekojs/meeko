import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { startDevServer } from '../../../../scripts/test-support/dev-server.ts'
import { createFixture } from '../../../../scripts/test-support/fixture.ts'

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

/** Every control of UI with a model, to edit them before the JavaScript arrives. */
export const earlyPage = `<script lang="ts">
import { signal } from '@meekojs/meeko'
const text = signal('')
const secret = signal('')
const note = signal('')
const accepted = signal(false)
const alerts = signal(false)
const period = signal('day')
const volume = signal(4)
const fruit = signal<string | null>(null)
const city = signal<string | null>(null)
const capped = signal(150)
const values = () => [text.value, secret.value, note.value, accepted.value, alerts.value, period.value, volume.value, fruit.value, city.value].join('|')
const sent = signal('')
</script>
<template>
<main id="contenido">
<form id="early" on:submit="(event) => { event.preventDefault(); sent.value = values() }">
<UIInput aria-label="Nombre" name="text" model="text" />
<UIInput aria-label="Clave" name="secret" type="password" model="secret" />
<UITextarea aria-label="Nota" name="note" model="note" />
<UICheckbox label="Aceptar" name="accepted" value="yes" model="accepted" />
<UISwitch label="Avisos" name="alerts" value="on" model="alerts" />
<UIRadioGroup legend="Periodo" name="period" model="period" bind:options="[{value:'day',label:'Día'},{value:'week',label:'Semana'}]" />
<UISlider label="Volumen" name="volume" bind:min="0" bind:max="10" bind:step="2" model="volume" />
<UISelect label="Fruta" name="fruit" placeholder="Elige" model="fruit" bind:options="['Manzana', 'Pera', 'Ciruela']" />
<UICombobox label="Ciudad" name="city" searchable placeholder="Busca" model="city" bind:options="['Lima', 'Quito', 'Bogotá']" />
<UISlider label="Tope" bind:max="100" model="capped" />
<output id="values">{values()}</output>
<output id="capped">{capped.value}</output>
<button id="send" type="submit">Enviar</button>
<button id="reset" type="button" on:click="() => { text.value = 'desde código'; accepted.value = false; volume.value = 2; period.value = 'day' }">Cambiar</button>
<output id="sent">{sent.value}</output>
</form>
</main>
</template>`

/** Isolated consumer, no edits to apps/ui. All resources are released by the caller's context. */
export async function startForms(context, { port = 4568, timeout = 120_000, page = formsPage } = {}) {
	const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
	const parent = join(packageRoot, '.meeko')
	const files = {
		'package.json': JSON.stringify({ name: 'ui-forms-test', private: true, type: 'module' }),
		'meeko.config.ts': `import { defineMeekoConfig } from '@meekojs/meeko/framework'\nexport default defineMeekoConfig({ modules: ['@meekojs/ui'] })\n`,
		'app/app.meeko': '<template><UIApp><MeekoOutlet /></UIApp></template>',
		'app/pages/index.meeko': page,
	}
	const fixture = await createFixture(context, parent, 'd1-forms-', { files, links: { '@meekojs/ui': packageRoot } })
	const { root } = fixture
	const cli = fileURLToPath(new URL('../../../meeko/dist/cli.js', import.meta.url))
	const { origin, child, stop } = await startDevServer({ root, cli, port, timeout, startupTimeout: 40_000 })
	fixture.setStop(stop)
	return { origin, root, server: child }
}
