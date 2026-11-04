import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { createFixture } from '../../../scripts/test-support/fixture.ts'
import { createI18n } from '../dist/index.js'
import { compileCatalog, messageParameters } from '../dist/messages.js'

test('runtime compiles placeholders and plurals', () => {
	const catalog = compileCatalog({ hello: 'Hola {name}', items: { plural: 'count', forms: { one: '{count} elemento', other: '{count} elementos' } } }, 'es.json')
	const i18n = createI18n({ locale: 'es', catalog, locales: ['es'], defaultLocale: 'es', path: () => '/' })
	assert.equal(i18n.t('hello', { name: 'Meeko' }), 'Hola Meeko')
	assert.equal(i18n.t('items', { count: 2 }), '2 elementos')
})

test('a missing message throws by default, or renders what missing returns', () => {
	const catalog = compileCatalog({ hello: 'Hola' }, 'es.json')
	const strict = createI18n({ locale: 'es', catalog, locales: ['es'], defaultLocale: 'es', path: () => '/' })
	assert.throws(() => strict.t('shell.menu'), { name: 'ReferenceError', message: 'Missing i18n message shell.menu for es' })
	const calls = []
	const lenient = createI18n({
		locale: 'es',
		catalog,
		locales: ['es'],
		defaultLocale: 'es',
		path: () => '/',
		missing: (key, locale) => {
			calls.push([key, locale])
			return key
		},
	})
	assert.equal(lenient.t('shell.menu'), 'shell.menu')
	assert.equal(lenient.t('hello'), 'Hola')
	assert.deepEqual(calls, [['shell.menu', 'es']])
})

test('message contracts infer selectors, all branches and numeric plural arguments', () => {
	const catalog = compileCatalog(
		{
			plain: 'Ready',
			hello: 'Hola {name}',
			items: { plural: 'total', forms: { one: '{owner}: {count} item', other: '{owner}: {count} items' } },
			invite: { select: 'gender', forms: { other: 'Invite {name}', female: 'Invite {name}' } },
		},
		'es.json',
	)
	assert.deepEqual(messageParameters(catalog.plain), {})
	assert.deepEqual(messageParameters(catalog.hello), { name: 'value' })
	assert.deepEqual(messageParameters(catalog.items), { owner: 'value', total: 'number' })
	assert.deepEqual(messageParameters(catalog.invite), { gender: 'value', name: 'value' })
})

test('consumer types require the generated parameters and reject incorrect plural values', async () => {
	const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
	await promisify(execFile)(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--module', 'nodenext', '--target', 'es2022', fileURLToPath(new URL('./types/consumer.ts', import.meta.url))], { windowsHide: true })
})

test('external module generates typed keys, builds SSR, and removes its types when disabled', async () => {
	const packageRoot = fileURLToPath(new URL('..', import.meta.url))
	const temporary = join(packageRoot, '.meeko', 'tests')
	const fixture = await createFixture(null, temporary, 'consumer-', { links: { '@meekojs/i18n': packageRoot } })
	const { root } = fixture
	const cli = fileURLToPath(new URL('./cli.js', import.meta.resolve('@meekojs/meeko')))
	async function put(path, contents) {
		const file = join(root, path)
		await mkdir(dirname(file), { recursive: true })
		await writeFile(file, contents)
	}
	async function run(command) {
		return promisify(execFile)(process.execPath, [cli, command, root], { cwd: packageRoot, windowsHide: true })
	}
	try {
		await put('package.json', '{"type":"module","private":true}')
		// The documented form since Meeko 1.8: the module by its name, its options in its configKey.
		await put('meeko.config.mjs', 'export default { modules: ["@meekojs/i18n"], i18n: { defaultLocale: "es", catalogs: { es: "es.json" } } };')
		await put('es.json', '{"hello":"Hola {name}"}')
		await put('app/pages/index.meeko', '<script lang="ts">const { t } = useI18n();</script><template><h1>{t("hello", { name: "Meeko" })}</h1></template>')
		await run('check')
		for (const expression of ['t("hello")', 't("hello", {})', 't("hello", { name: null })']) {
			await put('app/pages/index.meeko', `<script lang="ts">const { t } = useI18n();</script><template><h1>{${expression}}</h1></template>`)
			await assert.rejects(run('check'), /TS\d+/)
		}
		await put('app/pages/index.meeko', '<script lang="ts">const { t } = useI18n();</script><template><h1>{t("unknown", { name: "Meeko" })}</h1></template>')
		await assert.rejects(run('check'), /unknown/)
		await put('app/pages/index.meeko', '<script lang="ts">const { t } = useI18n();</script><template><h1>{t("hello", { name: "Meeko" })}</h1></template>')
		await run('build')
		const types = join(root, '.meeko', 'types', 'modules', '%40meekojs%2Fi18n', 'messages.d.ts')
		assert.match(await readFile(types, 'utf8'), /hello/)
		assert.match(await readFile(types, 'utf8'), /readonly "name"/)
		await put('en.json', '{"hello":"Hello {user}"}')
		await put('meeko.config.mjs', 'export default { modules: ["@meekojs/i18n"], i18n: { defaultLocale: "es", catalogs: { es: "es.json", en: "en.json" } } };')
		await assert.rejects(run('check'), /different parameters/)
		await put('en.json', '{"hello":"Hello {name}"}')
		// meeko check types the i18n key with the module's augmentation, loaded by .meeko/types/config.d.ts.
		await rm(join(root, 'meeko.config.mjs'))
		await put('meeko.config.ts', 'import { defineMeekoConfig } from "@meekojs/meeko/framework";\nexport default defineMeekoConfig({ modules: ["@meekojs/i18n"], i18n: { defaultLocale: "es", catalogs: { es: "es.json" }, directions: { es: "down" } } });\n')
		await assert.rejects(run('check'), /meeko\.config\.ts:2:\d+ TS2322: Type '"down"' is not assignable to type '"ltr" \| "rtl"'/)
		assert.match(await readFile(join(root, '.meeko', 'types', 'config.d.ts'), 'utf8'), /import type \{\} from "@meekojs\/i18n\/module";/)
		await put('meeko.config.ts', 'import { defineMeekoConfig } from "@meekojs/meeko/framework";\nexport default defineMeekoConfig({ modules: ["@meekojs/i18n"], i18n: { defaultLocale: "es", catalogs: { es: "es.json" }, directions: { es: "rtl" } } });\n')
		await run('check')
		await rm(join(root, 'meeko.config.ts'))
		await put('meeko.config.mjs', 'export default {};')
		await put('app/pages/index.meeko', '<template><h1>Ready</h1></template>')
		await run('check')
		await assert.rejects(readFile(types), { code: 'ENOENT' })
	} finally {
		await fixture.cleanup()
	}
})

test('<I18nT>, multilingual namespaces, usePageI18n and og:locale work in a real build, with their types checked', { timeout: 300_000 }, async () => {
	const packageRoot = fileURLToPath(new URL('..', import.meta.url))
	const temporary = join(packageRoot, '.meeko', 'tests')
	const fixture = await createFixture(null, temporary, 'rich-app-', { links: { '@meekojs/i18n': packageRoot } })
	const { root } = fixture
	const cli = fileURLToPath(new URL('./cli.js', import.meta.resolve('@meekojs/meeko')))
	const env = { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' }
	async function put(path, contents) {
		const file = join(root, path)
		await mkdir(dirname(file), { recursive: true })
		await writeFile(file, contents)
	}
	const run = (command) => promisify(execFile)(process.execPath, [cli, command, root], { cwd: packageRoot, windowsHide: true, env })
	const config = (extra = '') => `export default { site: "https://i18n.test", server: { adapter: "static" }, modules: ["@meekojs/i18n"], i18n: { defaultLocale: "es", catalogs: { es: { common: "locales/es/common.json", suggestion: "locales/es/suggestion.json" }, en: { common: "locales/en/common.json", suggestion: "locales/en/suggestion.json" } }, multilingual: ["suggestion"], ${extra} } };`
	const html = async (pathname) => (await readFile(join(root, '.meeko', 'output', 'static', ...pathname.split('/').filter(Boolean), 'index.html'), 'utf8')).replace(/<!--[^]*?-->/g, '')
	const rich = '<I18nT key="built" bind:values="{ name: \'Meeko\' }"><snippet name="code" params="text"><code>{text}</code></snippet></I18nT>'
	const page = (template) => `<script lang="ts">const i18n = useI18n();</script><template>${template}</template>`
	try {
		await put('package.json', '{"type":"module","private":true}')
		await put('locales/es/common.json', '{"built":"Hecho con <code>.meeko</code> por {name}.","title":"Título de {name}","plain":"Texto"}')
		await put('locales/en/common.json', '{"built":"Made by {name} with <code>.meeko</code>.","title":"Title of {name}","plain":"Text"}')
		await put('locales/es/suggestion.json', '{"suggestion":{"go":"Leer en español"}}')
		await put('locales/en/suggestion.json', '{"suggestion":{"go":"Read in English"}}')
		await put('meeko.config.mjs', config())
		await put('app/pages/index.route.ts', 'import { definePage } from "@meekojs/meeko/framework";\nexport const route = definePage({ render: "prerender" });\n')
		await put('app/pages/index.meeko', page(`<p id="rich">${rich}</p><a id="other" lang="en">{i18n.t("suggestion.go", {}, { locale: "en" })}</a><a id="own">{i18n.t("suggestion.go")}</a>`))
		await put(
			'app/pages/data.meeko',
			`<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";
export const route = definePage({ render: "prerender" });
const i18n = await usePageI18n();
export const info = { locale: i18n.locale, title: i18n.t("title", { name: "Meeko" }), other: i18n.t("title", { name: "Meeko" }, { locale: "en" }), link: i18n.localePath("/data"), dir: i18n.dir };
export const head = { title: i18n.t("plain") };
</script><template><p id="info">{info.locale}|{info.title}|{info.other}|{info.link}|{info.dir}</p></template>`,
		)

		// The types: the snippets are those of the message's tags, and the values those of the message.
		await run('check')
		const messages = await readFile(join(root, '.meeko', 'types', 'modules', '%40meekojs%2Fi18n', 'messages.d.ts'), 'utf8')
		assert.match(messages, /interface GeneratedI18nTags \{\n {4}"built": "code";\n {2}\}/)
		assert.match(messages, /interface GeneratedI18nLocales \{\n {4}"es": true;\n {4}"en": true;\n {2}\}/)
		const valid = await readFile(join(root, 'app', 'pages', 'index.meeko'), 'utf8')
		for (const [template, error] of [
			['<I18nT key="built" bind:values="{ name: \'x\' }" />', /TS\d+/],
			['<I18nT key="built" bind:values="{ name: \'x\' }"><snippet name="code" params="text">{text}</snippet><snippet name="kbd">x</snippet></I18nT>', /TS2353.*kbd|kbd/],
			['<I18nT key="unknown" />', /unknown/],
			['<I18nT key="plain" bind:values="{ extra: 1 }" />', /TS\d+/],
			['<I18nT key="built" bind:values="{ nombre: \'x\' }"><snippet name="code">x</snippet></I18nT>', /TS\d+/],
			['<p>{i18n.t("plain", {}, { locale: 1 })}</p>', /TS\d+/],
		]) {
			await put('app/pages/index.meeko', page(template))
			await assert.rejects(run('check'), error, template)
		}
		await put('app/pages/index.meeko', valid)
		// usePageI18n belongs to the server: a component's <script> cannot use it.
		await put('app/pages/bad.meeko', '<script lang="ts">const i18n = usePageI18n();</script><template><p>{String(i18n)}</p></template>')
		await assert.rejects(run('check'), /MEEK108/)
		await rm(join(root, 'app', 'pages', 'bad.meeko'))
		// Each language writes its own order, with the same tags.
		await put('locales/en/common.json', '{"built":"Made by {name} with <kbd>.meeko</kbd>.","title":"Title of {name}","plain":"Text"}')
		await assert.rejects(run('check'), /message built has different tags/)
		await put('locales/en/common.json', '{"built":"Made by {name} with <code>.meeko</code>.","title":"Title of {name}","plain":"Text"}')
		for (const [option, pattern] of [
			['multilingual: ["missing"]', /multilingual namespace missing/],
			['multilingual: ["common"]', /multilingual namespace common/],
			['ogLocale: { es: "es-ES" }', /ogLocale\.es must be/],
			['ogLocale: { fr: "fr_FR" }', /ogLocale\.fr must be/],
		]) {
			await put('meeko.config.mjs', config(option).replace('multilingual: ["suggestion"], ', ''))
			await assert.rejects(run('check'), pattern, option)
		}

		await put('meeko.config.mjs', config('ogLocale: { es: "es_MX" }'))
		await run('build')
		const spanish = await html('/')
		assert.match(spanish, /<p id="rich">Hecho con <code>\.meeko<\/code> por Meeko\.<\/p>/)
		assert.match(spanish, /<a id="other" lang="en">Read in English<\/a>/)
		assert.match(spanish, /<a id="own">Leer en español<\/a>/)
		assert.match(spanish, /<meta property="og:locale" content="es_MX"/)
		assert.match(spanish, /<meta property="og:locale:alternate" content="en_US"/)
		const english = await html('/en')
		assert.match(english, /<p id="rich">Made by Meeko with <code>\.meeko<\/code>\.<\/p>/, "the tag moves with the language's word order")
		assert.match(english, /<a id="own">Read in English<\/a>/)
		assert.match(english, /<meta property="og:locale" content="en_US"/)
		assert.match(english, /<meta property="og:locale:alternate" content="es_MX"/)
		assert.equal(english.match(/og:locale"/g).length, 1)
		// <script server>: the language of the URL and t(), on both versions of the page.
		assert.match(await html('/data'), /<p id="info">es\|Título de Meeko\|Title of Meeko\|\/data\|ltr<\/p>/)
		const data = await html('/en/data')
		assert.match(data, /<p id="info">en\|Title of Meeko\|Title of Meeko\|\/en\/data\|ltr<\/p>/)
		assert.match(data, /<title>Text<\/title>/)

		// ogLocale: false leaves the meta out; lang and hreflang stay.
		await put('meeko.config.mjs', config('ogLocale: false'))
		await run('build')
		const without = await html('/en')
		assert.doesNotMatch(without, /og:locale/)
		assert.match(without, /<html[^>]* lang="en"/)
		assert.match(without, /hreflang="es"/)
	} finally {
		await fixture.cleanup()
	}
})

test('prefix_except_default generates /en routes from the same pages, with lang, hreflang, lazy and global namespaces and a localized sitemap', { timeout: 240_000 }, async () => {
	const packageRoot = fileURLToPath(new URL('..', import.meta.url))
	const temporary = join(packageRoot, '.meeko', 'tests')
	const fixture = await createFixture(null, temporary, 'localized-', { links: { '@meekojs/i18n': packageRoot } })
	const { root } = fixture
	const shellFixture = await createFixture(null, temporary, 'shell-')
	const { root: shell } = shellFixture
	const cli = fileURLToPath(new URL('./cli.js', import.meta.resolve('@meekojs/meeko')))
	async function put(path, contents) {
		const file = join(root, path)
		await mkdir(dirname(file), { recursive: true })
		await writeFile(file, contents)
	}
	const prerender = 'import { definePage } from "@meekojs/meeko/framework";\nexport const route = definePage({ render: "prerender" });\n'
	async function html(pathname) {
		const base = join(root, '.meeko', 'output', 'static', ...pathname.split('/').filter(Boolean))
		for (const file of [join(base, 'index.html'), `${base}.html`]) {
			// Without hydration markers, to compare the markup.
			try {
				return (await readFile(file, 'utf8')).replace(/<!--[^]*?-->/g, '').replace(/ data-meeko="\d+"/g, '')
			} catch (error) {
				if (error.code !== 'ENOENT') throw error
			}
		}
		return undefined
	}
	try {
		await put('package.json', '{"type":"module","private":true}')
		// A shared shell linked by pnpm: its catalogs really live outside the project.
		await mkdir(join(shell, 'locales'), { recursive: true })
		await writeFile(join(shell, 'locales', 'es.json'), '{"shell":{"menu":"Menú"}}')
		await writeFile(join(shell, 'locales', 'en.json'), '{"shell":{"menu":"Menu"}}')
		await fixture.link('shared-shell', shell)
		// A path written outside the project is still rejected.
		await put('meeko.config.mjs', 'export default { modules: ["@meekojs/i18n"], i18n: { defaultLocale: "es", catalogs: { es: "../outside.json" } } };')
		await writeFile(join(temporary, 'outside.json'), '{}')
		await assert.rejects(promisify(execFile)(process.execPath, [cli, 'check', root], { cwd: packageRoot, windowsHide: true }), /leaves the project/)
		// A global namespace must exist in every catalog and cannot repeat common.
		for (const global of ['["missing"]', '["common"]']) {
			await put('meeko.config.mjs', `export default { modules: ["@meekojs/i18n"], i18n: { defaultLocale: "es", catalogs: { es: { common: "locales/es/common.json" } }, global: ${global} } };`)
			await put('locales/es/common.json', '{}')
			await assert.rejects(promisify(execFile)(process.execPath, [cli, 'check', root], { cwd: packageRoot, windowsHide: true }), /global namespace (missing|common) must be a namespace of every catalog/)
		}
		await put(
			'meeko.config.mjs',
			`export default {
  site: "https://i18n.test", sitemap: true, server: { adapter: "static" },
  modules: ["@meekojs/i18n"],
  i18n: {
    defaultLocale: "es",
    catalogs: {
      es: { common: "locales/es/common.json", guide: "locales/es/guide.json", shell: "node_modules/shared-shell/locales/es.json" },
      en: { common: "locales/en/common.json", guide: "locales/en/guide.json", shell: "node_modules/shared-shell/locales/en.json" },
    },
    global: ["shell"],
    routes: { "/guide": ["guide"] },
    exclude: ["/private", "/admin/*"],
  },
};`,
		)
		await put('locales/es/common.json', '{"nav":{"guide":"Guía"}}')
		await put('locales/en/common.json', '{"nav":{"guide":"Guide"}}')
		await put('locales/es/guide.json', '{"guide":{"title":"Hola {name}"}}')
		await put('locales/en/guide.json', '{"guide":{"title":"Hello {name}"}}')
		await put('app/pages/index.meeko', '<script lang="ts">const i18n = useI18n();</script><template><a id="guide" bind:href="i18n.localePath(\'/guide\')">{i18n.t("nav.guide")}</a><a id="switch" bind:href="i18n.switchLocalePath(i18n.locale === \'es\' ? \'en\' : \'es\')">{i18n.localeName(i18n.locale === \'es\' ? \'en\' : \'es\')}</a><MeekoLink id="link" to="/guide">G</MeekoLink><MeekoLink id="forced" to="/guide" hreflang="es">ES</MeekoLink><MeekoLink id="excluded" to="/private">P</MeekoLink><MeekoLink id="raw" to="/guide" bind:resolve="false">R</MeekoLink></template>')
		await put('app/pages/index.route.ts', prerender)
		await put('app/pages/guide.meeko', '<script lang="ts">const { t } = useI18n();</script><template><h1>{t("guide.title", { name: "Meeko" })}</h1><p>{t("shell.menu")}</p><MeekoLink id="self" to="/guide">G</MeekoLink></template>')
		await put('app/pages/guide.route.ts', prerender)
		// A page that no route lists still gets the global namespace, also in /en/about.
		await put('app/pages/about.meeko', '<script lang="ts">const { t } = useI18n();</script><template><p id="shell">{t("shell.menu")}</p></template>')
		await put('app/pages/about.route.ts', prerender)
		// A message of a namespace this route does not load renders its key and is reported once.
		await put('app/pages/unlisted.meeko', '<script lang="ts">const { t } = useI18n();</script><template><p id="unlisted">{t("guide.title", { name: "Meeko" })}</p></template>')
		await put('app/pages/unlisted.route.ts', prerender)
		// The error page has no route ID: common and the global namespaces still load (404.html).
		await put('app/error.meeko', '<script lang="ts">const { t } = useI18n();</script><template><p id="error">{t("nav.guide")} · {t("shell.menu")}</p></template>')
		await put('app/pages/private.meeko', '<template><p>Privado</p></template>')
		await put('app/pages/private.route.ts', prerender)
		await put('app/pages/legal.meeko', '<template><p>Aviso legal</p></template>')
		await put('app/pages/legal.route.ts', prerender)
		// A project page at a localized URL wins over the generated route: prose written per language.
		await put('app/pages/en/legal.meeko', '<template><p>Legal notice</p></template>')
		await put('app/pages/en/legal.route.ts', prerender)
		// Pages of an excluded route at both URLs: they exist, but they are not versions of one page.
		await put('app/pages/admin/users.meeko', '<template><p>Usuarios</p></template>')
		await put('app/pages/admin/users.route.ts', prerender)
		await put('app/pages/en/admin/users.meeko', '<template><p>Users</p></template>')
		await put('app/pages/en/admin/users.route.ts', prerender)
		const { stdout, stderr } = await promisify(execFile)(process.execPath, [cli, 'build', root], { cwd: packageRoot, windowsHide: true, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } })

		const home = await html('/')
		assert.match(home, /<html[^>]* lang="es"/)
		assert.match(home, /<a id="guide" href="\/guide">Guía<\/a>/)
		assert.match(home, /<a id="switch" href="\/en">English<\/a>/)
		assert.match(home, /<link rel="alternate" href="https:\/\/i18n\.test\/" hreflang="es"/)
		assert.match(home, /<link rel="alternate" href="https:\/\/i18n\.test\/en" hreflang="en"/)
		assert.match(home, /<link rel="alternate" href="https:\/\/i18n\.test\/" hreflang="x-default"/)
		const english = await html('/en')
		assert.match(english, /<html[^>]* lang="en" dir="ltr"/)
		assert.match(english, /<a id="guide" href="\/en\/guide">Guide<\/a>/)
		assert.match(english, /<a id="switch" href="\/">Español<\/a>/)
		// <MeekoLink to> follows the document's locale, or its hreflang; excluded routes and
		// bind:resolve="false" keep the href of href().
		assert.match(home, /<a id="link" href="\/guide"/)
		assert.match(english, /<a id="link" href="\/en\/guide"/)
		assert.match(english, /<a id="forced" hreflang="es" href="\/guide"/)
		assert.match(english, /<a id="excluded" href="\/private"/)
		assert.match(english, /<a id="raw" href="\/guide"/)
		// aria-current compares the resolved href with the localized route.
		assert.match(await html('/en/guide'), /<a id="self" href="\/en\/guide" aria-current="page"/)
		assert.match(await html('/guide'), /<a id="self" href="\/guide" aria-current="page"/)
		// The namespace of /guide also loads for its generated /en/guide route.
		assert.match(await html('/guide'), /<h1>Hola Meeko<\/h1>/)
		const guide = await html('/en/guide')
		assert.match(guide, /<h1>Hello Meeko<\/h1><p>Menu<\/p>/)
		assert.match(guide, /href="https:\/\/i18n\.test\/guide" hreflang="es"/)
		assert.match(await html('/about'), /<p id="shell">Menú<\/p>/)
		assert.match(await html('/en/about'), /<p id="shell">Menu<\/p>/)
		assert.match((await readFile(join(root, '.meeko', 'output', 'static', '404.html'), 'utf8')).replace(/<!--[^]*?-->/g, ''), /<p id="error">Guía · Menú<\/p>/)
		assert.match(await html('/unlisted'), /<p id="unlisted">guide\.title<\/p>/)
		assert.match(await html('/en/unlisted'), /<p id="unlisted">guide\.title<\/p>/)
		const warnings = `${stdout}${stderr}`.match(/\[meeko:i18n\] Missing message guide\.title for es/g) ?? []
		assert.equal(warnings.length, 1)
		assert.match(await html('/en/legal'), /Legal notice/)
		assert.match(await html('/legal'), /Aviso legal/)
		// An excluded route has no localized version and declares no alternates.
		assert.equal(await html('/en/private'), undefined)
		assert.doesNotMatch(await html('/private'), /hreflang/)
		assert.equal(await html('/es/guide'), undefined)

		const sitemap = await readFile(join(root, '.meeko', 'output', 'static', 'sitemap.xml'), 'utf8')
		assert.match(sitemap, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/)
		assert.match(sitemap, /<url><loc>https:\/\/i18n\.test\/en\/guide<\/loc><xhtml:link rel="alternate" hreflang="es" href="https:\/\/i18n\.test\/guide"\/><xhtml:link rel="alternate" hreflang="en" href="https:\/\/i18n\.test\/en\/guide"\/><xhtml:link rel="alternate" hreflang="x-default" href="https:\/\/i18n\.test\/guide"\/><\/url>/)
		assert.match(sitemap, /<url><loc>https:\/\/i18n\.test\/legal<\/loc><xhtml:link rel="alternate" hreflang="es"/)
		assert.match(sitemap, /<url><loc>https:\/\/i18n\.test\/private<\/loc><\/url>/)
		// The sitemap agrees with the <head>: an excluded route declares no alternates in either.
		assert.doesNotMatch(await html('/admin/users'), /hreflang/)
		assert.doesNotMatch(await html('/en/admin/users'), /hreflang/)
		assert.match(sitemap, /<url><loc>https:\/\/i18n\.test\/admin\/users<\/loc><\/url>/)
		assert.match(sitemap, /<url><loc>https:\/\/i18n\.test\/en\/admin\/users<\/loc><\/url>/)
	} finally {
		await fixture.cleanup()
		await shellFixture.cleanup()
		await rm(join(temporary, 'outside.json'), { force: true })
	}
})
