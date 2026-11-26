import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
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
			.replace(/from ["']\.\/(\w+)\.meeko["']/g, 'from "./$1.ts"')
			.replace(/from ["'](?:\.\.\/)+(utils|theme(?:\/components)?)\/([\w-]+)["']/g, (_, folder, utility) => `from ${JSON.stringify(new URL(`../dist/app/${folder}/${utility}.js`, import.meta.url).href)}`)
			.replace(/from ["']\.\/internal\/Icon\.meeko["']/g, 'from "./Icon.ts"')
		await writeFile(`${directory}/${file}.ts`, code)
	}
	let source = await readFile(new URL(`../src/app/components/${name}.meeko`, import.meta.url), 'utf8')
	if (name === 'Card' || name === 'Table') source = source.replace('<script lang="ts"', '<script lang="ts"').replace(/(<script[^>]*>)/, '$1\nimport { useId } from "@meekojs/meeko"')
	if (source.includes('./internal/Icon.meeko')) await write('Icon', await readFile(new URL('../src/app/components/internal/Icon.meeko', import.meta.url), 'utf8'))
	// The components it renders, and theirs: the <UISparkline> and the <UIHint> of <UIStat>, whose <UITooltip> renders a <UIPopover>.
	const siblings = new Set()
	const addSiblings = async (code) => {
		for (const [, sibling] of code.matchAll(/from ["']\.\/(\w+)\.meeko["']/g)) {
			if (sibling === name || siblings.has(sibling)) continue
			siblings.add(sibling)
			const own = await readFile(new URL(`../src/app/components/${sibling}.meeko`, import.meta.url), 'utf8')
			if (own.includes('./internal/Icon.meeko')) await write('Icon', await readFile(new URL('../src/app/components/internal/Icon.meeko', import.meta.url), 'utf8'))
			await write(sibling, own)
			await addSiblings(own)
		}
	}
	await addSiblings(source)
	const componentFile = basename(name)
	await write(componentFile, source)
	await write('Page', `<script lang="ts">import { signal } from "@meekojs/meeko"; import * as Component from "./${componentFile}.meeko"</script><template>${template}</template>`)
	const page = await import(pathToFileURL(`${directory}/Page.ts`).href)
	return createRoot(() => {
		provide(routeKey, {})
		return page.renderToString({}).replace(/<!--.*?-->/g, '')
	})
}

const cases = [
	[
		'Form/Select/Select',
		`<Component name="plan" model="signal<string | null>('personal')" bind:options="[{ value: 'personal', label: 'Personal' }, { value: 'team', label: 'Equipo', disabled: true }]" />`,
		[/<input(?=[^>]*type="hidden")(?=[^>]*name="plan")(?=[^>]*value="personal")/, /aria-haspopup="listbox"/, /popovertarget="([^"]+)"[\s\S]*role="listbox"[^>]*id="\1"/, /role="option"[^>]*aria-selected="true"[^>]*>\s*<span>Personal<\/span>/, /role="option"[^>]*\sdisabled[^>]*>\s*<span>Equipo<\/span>/],
	],
	['Textarea', '<Component name="comment" bind:rows="4" bind:maxlength="200" describedBy="hint" bind:invalid="true" model="signal(\'Initial\')" />', [/name="comment"/, /rows="4"/, /maxlength="200"/, /aria-invalid="true"/, /aria-describedby="hint"/, />Initial<\/textarea>/]],
	['Checkbox', '<Component label="Accept" name="accepted" value="yes" bind:required="true" model="signal(true)" description="Terms" />', [/type="checkbox"/, /checked/, /required/, /name="accepted"/, /value="yes"/, /Terms/]],
	['RadioGroup', '<Component legend="Period" name="period" variant="segmented" model="signal(\'week\')" bind:options="[{ value: \'day\', label: \'Day\' }, { value: \'week\', label: \'Week\' }]" />', [/<fieldset/, /<legend[^>]*>Period<\/legend>/, /type="radio"/, /name="period"/, /<div class="[^"]*w-fit[^"]*"/, /<input(?=[^>]*\svalue="week")(?=[^>]*\schecked)/]],
	['Switch', '<Component label="Notifications" name="notifications" model="signal(true)" />', [/type="checkbox"/, /role="switch"/, /checked/, /Notifications/]],
	['Slider', '<Component label="Volume" name="volume" bind:min="0" bind:max="10" bind:step="2" model="signal(4)" />', [/type="range"/, /min="0"/, /max="10"/, /step="2"/, /value="4"/]],
	['Alert', '<Component title="Failed" description="Try again" color="danger" bind:dismiss="true"><snippet name="actions"><a href="/retry">Retry</a></snippet></Component>', [/role="alert"/, /Failed/, /Try again/, /href="\/retry"/, /aria-label="Cerrar aviso"/]],
	['Alert', '<div role="status"><Component description="Sent" color="success" role="none" /></div>', [/role="none"/, /class="(?=[^"]*\bbg-success-3\b)(?=[^"]*\bborder-success-7\b)(?=[^"]*\btext-success-11\b)[^"]*"/, /Sent/, /^(?![\s\S]*\s(?:variant|color)=)/]],
	['Alert', '<Component description="Sent" variant="solid" color="danger" bind:dismiss="true" />', [/role="alert"/, /<section class="(?=[^"]*\bbg-danger-9\b)(?=[^"]*\btext-danger-contrast\b)(?![^"]*not-disabled:)[^"]*"/, /<button[^>]*class="[^"]*hover:bg-gray-a4[^"]*"/]],
	['Disclosure', '<Component summary="More" bind:open="true"><p>Inside</p></Component>', [/<details[^>]*open/, /<summary[^>]*class="[^"]*list-none[^"]*"[^>]*>[\s\S]*More/, /<p>Inside<\/p>/]],
	['Disclosure', '<Component summary="More"><p>Inside</p></Component>', [/<details(?![^>]*open)/, /<p>Inside<\/p>/]],
	['Table', `<Component rowKey="id" bind:rows="[{ id: 1 }]" bind:columns="[{ key: 'id', label: 'Id' }]"><snippet name="caption"><span lang="es">Título</span></snippet></Component>`, [/role="region"/, /aria-labelledby="[^"]*-caption"/, /<caption[^>]*>\s*<span lang="es">Título<\/span>/]],
	['Empty', '<Component><snippet name="title">Nothing for <kbd>x</kbd></snippet></Component>', [/<p class="[^"]*font-semibold[^"]*"[^>]*>[\s\S]*Nothing for[\s\S]*<kbd[^>]*>x<\/kbd>/, /^(?![\s\S]*No hay resultados)/]],
	['Empty', '<Component description="Add an item" variant="panel"><snippet name="actions"><button>Add</button></snippet></Component>', [/No hay resultados\./, /class="[^"]*p-6[^"]*"/, /Add an item/, /<button>Add<\/button>/]],
	['Skeleton', '<Component bind:lines="2" bind:widths="[\'long\', \'short\']" />', [/role="status"/, /aria-label="Cargando"/, /class="[^"]*w-\(--ui-skeleton-width-long\)/, /class="[^"]*w-\(--ui-skeleton-width-short\)/]],
	['Alert', '<Component title="Hi" class="my-class" bind:ui="{ base: \'my-base\', title: \'my-title\' }" />', [/<section class="[^"]*rounded-lg[^"]* my-base my-class"/, /<p class="[^"]*font-semibold[^"]* my-title"/]],
	['Stat', '<Component label="Visits" bind:value="1200" detail="This week" />', [/<dl/, /<dt[^>]*>Visits<\/dt>/, />1200<\/dd>/, /This week/]],
	['DescriptionList', "<Component bind:columns=\"2\" bind:items=\"[{ label: 'Status', value: 'Active', detail: 'Today' }]\" />", [/<dl class="[^"]*compact:grid-cols-2/, /<dt[^>]*>Status<\/dt>/, /<dd[^>]*>Active<\/dd>/, /Today/]],
	['DescriptionList', "<Component bind:items=\"[{ label: 'Fecha', labelLang: 'es', value: '15 يناير' }]\" />", [/<dt lang="es"[^>]*>Fecha<\/dt>/, /<dd[^>]*>15 يناير<\/dd>/]],
	['Toast', '<Component text="Saved" color="success" bind:duration="0" />', [/popover="manual"/, /role="status"/, /Saved/, /aria-label="Cerrar aviso"/, /<div class="(?=[^"]*\bbg-success-3\b)(?=[^"]*\bborder-success-7\b)[^"]*"/]],
	['Toast', '<Component text="Saved" bind:duration="0" />', [/<div class="(?=[^"]*\bbg-surface-raised\b)(?=[^"]*\bborder-border\b)(?=[^"]*\btext-text\b)[^"]*"/]],
	['Toast', '<Component text="Failed" color="danger" variant="outline" bind:duration="0" />', [/role="alert"/, /<div class="(?=[^"]*\bborder-danger-7\b)(?=[^"]*\btext-danger-11\b)(?![^"]*\bbg-danger-3\b)[^"]*"/]],
	['Input', '<Component type="datetime-local" autocomplete="off" autocapitalize="none" bind:spellcheck="false" min="2026-01-01T00:00" max="2026-12-31T00:00" bind:step="60" />', [/type="datetime-local"/, /autocomplete="off"/, /autocapitalize="none"/, /spellcheck="false"/, /min="2026-01-01T00:00"/, /max="2026-12-31T00:00"/, /step="60"/]],
	['Input', '<Component type="number" min="0" max="10" step="0.5" inputmode="decimal" model="signal(\'2.5\')" />', [/type="number"/, /min="0"/, /max="10"/, /step="0.5"/, /inputmode="decimal"/, /value="2.5"/, /class="[^"]*\[font-variant-numeric:tabular-nums\]/]],
	['Input', '<Component type="time" step="900" model="signal(\'09:30\')" />', [/type="time"/, /step="900"/, /value="09:30"/, /class="[^"]*\[&amp;::-webkit-date-and-time-value\]:text-start|class="[^"]*\[&::-webkit-date-and-time-value\]:text-start/]],
	['Input', '<Component type="month" min="2026-01" model="signal(\'2026-11\')" />', [/type="month"/, /min="2026-01"/, /value="2026-11"/, /class="[^"]*\[font-variant-numeric:tabular-nums\]/]],
	['Input', '<Component name="q" model="signal(\'hola\')" />', [/type="text"/, /value="hola"/, /^(?![\s\S]*tabular-nums)/]],
	['Field', '<Component id="comment" label="Comment" hint="Optional" counter="10/200" error="Too long"><snippet name="default" params="id, describedBy"><input bind:id="id" bind:aria-describedby="describedBy" /></snippet></Component>', [/aria-describedby="comment-error comment-hint comment-counter"/, /id="comment-hint"/, /id="comment-counter"/, /10\/200/, /role="alert"/]],
	['Badge', '<Component color="warning" bind:dot="true">Pending</Component>', [/class="(?=[^"]*\bbg-warning-3\b)(?=[^"]*\btext-warning-11\b)(?=[^"]*\bborder-transparent\b)(?![^"]*not-disabled:)[^"]*"/, /<span(?=[^>]*aria-hidden="true")[^>]*class="[^"]*bg-current/, /Pending/]],
	['Badge', '<Component bind:dot="true" bind:ui="{ base: \'my-base\', dot: \'my-dot\' }" class="my-class">Ok</Component>', [/<span class="[^"]*rounded-full[^"]* my-base my-class"/, /class="[^"]*bg-current[^"]* my-dot"/]],
	['Button', '<Component type="submit" name="intent" value="save" form="editor" color="danger" bind:loading="true" ariaLabel="Save" bind:iconOnly="true">Save</Component>', [/type="submit"/, /name="intent"/, /value="save"/, /form="editor"/, /aria-busy="true"/, /aria-disabled="true"/, /aria-label="Save"/, /class="[^"]*bg-danger-9 [^"]*p-0[ "]/]],
	['Card', '<Component title="Summary" density="compact" padding="none">Details</Component>', [/<section class="[^"]*\[--card-padding:var\(--ui-space-0\)\]/, /^(?![\s\S]*--ui-space-3)/, /Summary/, /Details/]],
	['Card', '<Component id="box" title="Summary" headingId="summary-title" description="Why"><snippet name="actions"><button>Go</button></snippet>Details</Component>', [/<section[^>]*id="box"/, /<section[^>]*aria-labelledby="summary-title"/, /<h2[^>]*id="summary-title"[^>]*tabindex="-1"/, /<header class="[^"]*grid-cols-\[minmax\(0,1fr\)_auto\]/, /<div class="[^"]*col-\[2\][^"]*"[^>]*>\s*<button>Go<\/button>/]],
	['Button', '<Component type="submit" variant="ghost" color="danger" radius="full">Save</Component>', [/type="submit"/, /class="[^"]*rounded-full[^"]*text-danger-11/, /^(?![\s\S]* (?:variant|color|radius)=)/]],
	['Badge', '<Component variant="solid" color="success" radius="sm" dot>Ready</Component>', [/class="(?=[^"]*\brounded-sm\b)(?=[^"]*\bbg-success-9\b)(?![^"]*\brounded-full\b)[^"]*"/, /aria-hidden="true"/, /Ready/, /^(?![\s\S]*\s(?:variant|color|radius)=)/]],
	['Badge', '<Component>Draft</Component>', [/<span class="(?=[^"]*\bborder-border\b)(?=[^"]*\bbg-control\b)(?=[^"]*\btext-text-soft\b)(?=[^"]*\brounded-full\b)(?![^"]*\bborder-transparent\b)[^"]*"/]],
	['Input', `<Component variant="soft" color="danger" size="lg" bind:invalid="true" name="email" />`, [/name="email"/, /aria-invalid="true"/, /class="(?=[^"]*--ui-control-height-lg)(?=[^"]*\bbg-danger-3\b)(?=[^"]*aria-\[invalid=true\]:border-danger)[^"]*"/, /^(?![\s\S]* (?:variant|color|size)=)/]],
	['Card', '<Component title="Summary" variant="glass" color="primary" elevation="lg">Details</Component>', [/<section class="(?=[^"]*\bshadow-lg\b)(?=[^"]*\bbg-gray-a3\b)(?=[^"]*\btext-primary-11\b)(?=[^"]*\bbackdrop-blur-md\b)/, /^(?![\s\S]*\s(?:variant|color|elevation)=)/, /aria-labelledby=/, /Details/]],
	['Card', '<Component aria-label="Totals">Details</Component>', [/<section[^>]*aria-label="Totals"/, /^(?![\s\S]*aria-labelledby)/, /^(?![\s\S]*<header)/]],
	['Stat', '<Component label="Snapshot"><snippet name="value"><a href="/snapshots">#7</a></snippet><snippet name="detail"><em>Today</em></snippet></Component>', [/<dd class="[^"]*text-2xl[^"]*"[^>]*>\s*<a href="\/snapshots">#7<\/a>/, /<dd class="[^"]*text-sm[^"]*"[^>]*>\s*<em>Today<\/em>/]],
	['DescriptionList', "<Component bind:items=\"[{ label: 'Hash', value: 'abc123', code: true, title: 'abc123def456' }, { label: 'Note', value: 'Plain' }]\" />", [/<code[^>]*title="abc123def456"[^>]*>\s*abc123\s*<\/code>/, /<dd[^>]*>Plain<\/dd>/]],
	['Table', '<Component caption="Results" bind:hideCaption="true" rowKey="id" bind:rows="[{ id: 1 }]" bind:columns="[{ key: \'id\', label: \'Id\' }]" />', [/<caption[^>]*\[clip-path:inset\(50%\)\]/, /<caption[^>]*>\s*Results/, /role="region"/]],
	['Table', '<Component caption="Results" density="compact" rowKey="id" bind:rows="[{ id: 1, name: \'Ana\', count: 5 }]" bind:columns="[{ key: \'name\', label: \'Name\', rowHeader: true }, { key: \'count\', label: \'Count\', numeric: true }]" />', [/<th[^>]*class="[^"]*px-2 py-1/, /<th[^>]*role="rowheader"[^>]*scope="row"/, /<td[^>]*class="[^"]*text-end/, /Ana/, />5<\/span>/]],
]

for (const [name, template, patterns] of cases) {
	test(`${name} renders its public contract in SSR`, { timeout: 30_000 }, async (context) => {
		const html = await render(context, name, template)
		for (const pattern of patterns) assert.match(html, pattern)
	})
}

/** The classes of the first element that matches `tag`. */
const classesOf = (html, tag) => (html.match(new RegExp(`<${tag}\\b[^>]*?class="([^"]*)"`))?.[1] ?? '').split(' ')

test('the class of the consumer replaces the conflicting classes of a theme recipe, and keeps the rest', { timeout: 30_000 }, async (context) => {
	// The utilities of UI and those of the app share the layer `utilities`: without the merge, the order of the sheet would decide.
	const field = classesOf(await render(context, 'Input', '<Component name="q" class="bg-amber-500 text-blue-600 rounded-none my-field" />'), 'input')
	for (const name of ['bg-amber-500', 'text-blue-600', 'rounded-none', 'my-field', 'border-control-border', 'not-disabled:hover:bg-control-hover', 'placeholder:text-text-soft', 'min-h-(--ui-control-height-md)']) assert.ok(field.includes(name), `${name} in ${field.join(' ')}`)
	for (const name of ['bg-control', 'text-text', 'rounded-md']) assert.ok(!field.includes(name), `${name} gives way to the class of the consumer`)
	const themed = classesOf(await render(context, 'Input', `<Component name="q" variant="soft" color="danger" class="border-amber-500 bg-amber-100 px-6" />`), 'input')
	assert.ok(themed.includes('border-amber-500') && !themed.includes('border-control-border'), themed.join(' '))
	assert.ok(themed.includes('bg-amber-100') && !themed.includes('bg-danger-3') && themed.includes('not-disabled:hover:bg-danger-4'), themed.join(' '))
	assert.ok(themed.includes('px-6') && !themed.includes('ps-3') && !themed.includes('pe-3'), themed.join(' '))
	const badgeHtml = await render(context, 'Badge', `<Component color="warning" bind:dot="true" class="bg-amber-500 text-sm" bind:ui="{ dot: 'bg-red-500' }">Pending</Component>`)
	const badge = classesOf(badgeHtml, 'span')
	for (const name of ['bg-amber-500', 'text-sm', 'text-warning-11', 'rounded-full', 'leading-snug']) assert.ok(badge.includes(name), `${name} in ${badge.join(' ')}`)
	for (const name of ['bg-warning-3', 'text-xs']) assert.ok(!badge.includes(name), `${name} gives way to the class of the consumer`)
	const dot = badgeHtml.match(/<span[^>]*aria-hidden="true"[^>]*class="([^"]*)"|<span[^>]*class="([^"]*)"[^>]*aria-hidden="true"/)
	const dotClasses = (dot[1] ?? dot[2]).split(' ')
	assert.ok(dotClasses.includes('bg-red-500') && !dotClasses.includes('bg-current') && dotClasses.includes('rounded-full'), dotClasses.join(' '))
	const alert = await render(context, 'Alert', '<Component title="Hi" class="rounded-none p-1" />')
	const box = classesOf(alert, 'section')
	assert.ok(box.includes('rounded-none') && !box.includes('rounded-lg') && box.includes('p-1') && !box.includes('p-4'), box.join(' '))
	const colored = classesOf(await render(context, 'Alert', '<Component title="Hi" color="info" class="border-amber-500 bg-white" />'), 'section')
	assert.ok(colored.includes('border-amber-500') && !colored.includes('border-info-7') && colored.includes('bg-white') && !colored.includes('bg-info-3') && colored.includes('text-info-11'), colored.join(' '))
})

test('no native control links its value by hand: model is what takes what was edited before hydration', async () => {
	const handmade = []
	for (const folder of ['../src/app/components/', '../src/editor/components/']) {
		const directory = new URL(folder, import.meta.url)
		for (const file of await readdir(directory)) {
			if (!file.endsWith('.meeko')) continue
			const source = await readFile(new URL(file, directory), 'utf8')
			for (const [tag] of source.matchAll(/<(?:input|textarea|select)\b(?:[^"'>]|"[^"]*"|'[^']*')*>/g)) {
				if (/\sbind:(?:value|checked)=/.test(tag) && /\son:(?:input|change)=/.test(tag)) handmade.push(file)
			}
		}
	}
	// The search of UICombobox is no model: its text is a query, and its mount adopts what was typed early.
	assert.deepEqual(handmade, ['Combobox.meeko'])
})
