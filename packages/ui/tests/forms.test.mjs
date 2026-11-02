import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { routeKey } from '../../meeko/dist/app/runtime/navigation.js'
import { compile } from '../../meeko/dist/compiler.js'
import { createRoot, provide } from '../../meeko/dist/index.js'

/** Compile a real component and consumer with the same runtime instance. */
async function render(context, name, template) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'forms-render-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const runtime = (path) => JSON.stringify(new URL(`../../meeko/dist/${path}`, import.meta.url).href)
	const write = async (file, source) => {
		const code = compile(source, `${directory}/${file}.meeko`)
			.code.replaceAll('from "@meekojs/meeko/internal"', `from ${runtime('internal.js')}`)
			.replaceAll('from "@meekojs/meeko"', `from ${runtime('index.js')}`)
			.replaceAll(`from "./${name}.meeko"`, `from "./${name}.ts"`)
			.replace(/from ["']\.\.\/utils\/([\w-]+)["']/g, (_, utility) => `from ${JSON.stringify(new URL(`../dist/app/utils/${utility}.js`, import.meta.url).href)}`)
			.replace(/from ["']\.\/internal\/Icon\.meeko["']/g, 'from "./Icon.ts"')
		await writeFile(`${directory}/${file}.ts`, code)
	}
	let source = await readFile(new URL(`../src/app/components/${name}.meeko`, import.meta.url), 'utf8')
	if (name === 'Card' || name === 'Table') source = source.replace('<script lang="ts"', '<script lang="ts"').replace(/(<script[^>]*>)/, '$1\nimport { useId } from "@meekojs/meeko"')
	if (source.includes('./internal/Icon.meeko')) await write('Icon', await readFile(new URL('../src/app/components/internal/Icon.meeko', import.meta.url), 'utf8'))
	await write(name, source)
	await write('Page', `<script lang="ts">import { signal } from "@meekojs/meeko"; import * as Component from "./${name}.meeko"</script><template>${template}</template>`)
	const page = await import(pathToFileURL(`${directory}/Page.ts`).href)
	return createRoot(() => {
		provide(routeKey, {})
		return page.renderToString({}).replace(/<!--.*?-->/g, '')
	})
}

const cases = [
	['Textarea', '<Component name="comment" bind:rows="4" bind:maxlength="200" describedBy="hint" bind:invalid="true" model="signal(\'Initial\')" />', [/name="comment"/, /rows="4"/, /maxlength="200"/, /aria-invalid="true"/, /aria-describedby="hint"/, />Initial<\/textarea>/]],
	['Checkbox', '<Component label="Accept" name="accepted" value="yes" bind:required="true" model="signal(true)" description="Terms" />', [/type="checkbox"/, /checked/, /required/, /name="accepted"/, /value="yes"/, /Terms/]],
	['RadioGroup', '<Component legend="Period" name="period" variant="segmented" model="signal(\'week\')" bind:options="[{ value: \'day\', label: \'Day\' }, { value: \'week\', label: \'Week\' }]" />', [/<fieldset/, /<legend>Period<\/legend>/, /type="radio"/, /name="period"/, /data-variant="segmented"/, /value="week"[^>]*checked/]],
	['Switch', '<Component label="Notifications" name="notifications" model="signal(true)" />', [/type="checkbox"/, /role="switch"/, /checked/, /Notifications/]],
	['Slider', '<Component label="Volume" name="volume" bind:min="0" bind:max="10" bind:step="2" model="signal(4)" />', [/type="range"/, /min="0"/, /max="10"/, /step="2"/, /value="4"/]],
	['Alert', '<Component title="Failed" description="Try again" tone="danger" bind:dismiss="true"><snippet name="actions"><a href="/retry">Retry</a></snippet></Component>', [/role="alert"/, /Failed/, /Try again/, /href="\/retry"/, /aria-label="Cerrar aviso"/]],
	['Alert', '<div role="status"><Component description="Sent" tone="success" role="none" /></div>', [/role="none"/, /data-tone="success"/, /Sent/]],
	['Disclosure', '<Component summary="More" bind:open="true"><p>Inside</p></Component>', [/<details[^>]*class="meeko-ui-disclosure"/, /<details[^>]*open/, /<summary>[\s\S]*More/, /<p>Inside<\/p>/]],
	['Disclosure', '<Component summary="More"><p>Inside</p></Component>', [/<details(?![^>]*open)/, /<p>Inside<\/p>/]],
	['Table', `<Component rowKey="id" bind:rows="[{ id: 1 }]" bind:columns="[{ key: 'id', label: 'Id' }]"><snippet name="caption"><span lang="es">Título</span></snippet></Component>`, [/role="region"/, /aria-labelledby="[^"]*-caption"/, /<caption[^>]*>\s*<span lang="es">Título<\/span>/]],
	['Empty', '<Component><snippet name="title">Nothing for <kbd>x</kbd></snippet></Component>', [/meeko-ui-empty-title[^>]*>[\s\S]*Nothing for[\s\S]*<kbd[^>]*>x<\/kbd>/, /^(?![\s\S]*No hay resultados)/]],
	['Empty', '<Component description="Add an item" variant="panel"><snippet name="actions"><button>Add</button></snippet></Component>', [/No hay resultados\./, /data-variant="panel"/, /Add an item/, /<button>Add<\/button>/]],
	['Skeleton', '<Component bind:lines="2" bind:widths="[\'long\', \'short\']" />', [/role="status"/, /aria-label="Cargando"/, /data-width="long"/, /data-width="short"/]],
	['Stat', '<Component label="Visits" bind:value="1200" detail="This week" />', [/<dl/, /<dt>Visits<\/dt>/, />1200<\/dd>/, /This week/]],
	['DescriptionList', "<Component bind:columns=\"2\" bind:items=\"[{ label: 'Status', value: 'Active', detail: 'Today' }]\" />", [/<dl/, /data-columns="2"/, /<dt[^>]*>Status<\/dt>/, /<dd>Active<\/dd>/, /Today/]],
	['DescriptionList', "<Component bind:items=\"[{ label: 'Fecha', labelLang: 'es', value: '15 يناير' }]\" />", [/<dt lang="es"[^>]*>Fecha<\/dt>/, /<dd>15 يناير<\/dd>/]],
	['Toast', '<Component text="Saved" tone="success" bind:duration="0" />', [/popover="manual"/, /role="status"/, /Saved/, /aria-label="Cerrar aviso"/]],
	['Input', '<Component type="datetime-local" autocomplete="off" autocapitalize="none" bind:spellcheck="false" min="2026-01-01T00:00" max="2026-12-31T00:00" bind:step="60" />', [/type="datetime-local"/, /autocomplete="off"/, /autocapitalize="none"/, /spellcheck="false"/, /min="2026-01-01T00:00"/, /max="2026-12-31T00:00"/, /step="60"/]],
	['Field', '<Component id="comment" label="Comment" hint="Optional" counter="10/200" error="Too long"><snippet name="default" params="id, describedBy"><input bind:id="id" bind:aria-describedby="describedBy" /></snippet></Component>', [/aria-describedby="comment-error comment-hint comment-counter"/, /id="comment-hint"/, /id="comment-counter"/, /10\/200/, /role="alert"/]],
	['Badge', '<Component tone="warning" bind:dot="true">Pending</Component>', [/data-tone="warning"/, /class="meeko-ui-badge-dot" aria-hidden="true"/, /Pending/]],
	['Button', '<Component type="submit" name="intent" value="save" form="editor" tone="danger" bind:loading="true" ariaLabel="Save" bind:iconOnly="true">Save</Component>', [/type="submit"/, /name="intent"/, /value="save"/, /form="editor"/, /aria-busy="true"/, /aria-disabled="true"/, /aria-label="Save"/, /data-icon-only/]],
	['Card', '<Component title="Summary" density="compact" padding="none">Details</Component>', [/data-density="compact"/, /data-padding="none"/, /Summary/, /Details/]],
	['Card', '<Component id="box" title="Summary" headingId="summary-title" description="Why"><snippet name="actions"><button>Go</button></snippet>Details</Component>', [/<section[^>]*id="box"/, /<section[^>]*aria-labelledby="summary-title"/, /<h2[^>]*id="summary-title"[^>]*tabindex="-1"/, /<header[^>]*data-actions/, /class="meeko-ui-card-actions"[^>]*>\s*<button>Go<\/button>/]],
	['Card', '<Component aria-label="Totals">Details</Component>', [/<section[^>]*aria-label="Totals"/, /^(?![\s\S]*aria-labelledby)/, /^(?![\s\S]*<header)/]],
	['Stat', '<Component label="Snapshot"><snippet name="value"><a href="/snapshots">#7</a></snippet><snippet name="detail"><em>Today</em></snippet></Component>', [/class="meeko-ui-stat-value"[^>]*>\s*<a href="\/snapshots">#7<\/a>/, /class="meeko-ui-stat-detail"[^>]*>\s*<em>Today<\/em>/]],
	['DescriptionList', "<Component bind:items=\"[{ label: 'Hash', value: 'abc123', code: true, title: 'abc123def456' }, { label: 'Note', value: 'Plain' }]\" />", [/<code[^>]*title="abc123def456"[^>]*>\s*abc123\s*<\/code>/, /<dd>Plain<\/dd>/]],
	['Table', '<Component caption="Results" bind:hideCaption="true" rowKey="id" bind:rows="[{ id: 1 }]" bind:columns="[{ key: \'id\', label: \'Id\' }]" />', [/data-caption="hidden"/, /<caption[^>]*>\s*Results/, /role="region"/]],
	['Table', '<Component caption="Results" density="compact" rowKey="id" bind:rows="[{ id: 1, name: \'Ana\', count: 5 }]" bind:columns="[{ key: \'name\', label: \'Name\', rowHeader: true }, { key: \'count\', label: \'Count\', numeric: true }]" />', [/data-density="compact"/, /<th[^>]*role="rowheader"[^>]*scope="row"/, /data-numeric/, /Ana/, />5<\/span>/]],
]

for (const [name, template, patterns] of cases) {
	test(`${name} renders its public contract in SSR`, { timeout: 30_000 }, async (context) => {
		const html = await render(context, name, template)
		for (const pattern of patterns) assert.match(html, pattern)
	})
}
