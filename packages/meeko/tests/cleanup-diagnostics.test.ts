import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test, { describe } from 'node:test'
import { DiagnosticSeverity } from 'vscode-languageserver/node'

import type { CleanupFix } from '../src/language-server/cleanup.ts'

import { checkSource } from '../src/check.ts'
import { hasErrors } from '../src/compiler/parser/sfc.ts'
import { checkApp } from '../src/framework/check-app.ts'
import { browserOnlyGlobals, cleanupAfterAwaitMessage, cleanupBrowserApiMessage, cleanupFixes, cleanupOutsideRootMessage, componentCleanupDiagnostics, moduleCleanupDiagnostics } from '../src/language-server/cleanup.ts'
import { componentDiagnostics } from '../src/language-server/diagnostics.ts'
import { cleanupActions } from '../src/language-server/quick-fixes.ts'
import { languageProject } from './language-server-workspace.ts'

/** The user's report: browser cleanups at the top level of the setup, which also run after SSR. */
const userCleanup = `onCleanup(() => {
	cancelAnimationFrame(frame)
	observer?.disconnect()
	window.removeEventListener('resize', scheduleUpdate)
	window.visualViewport?.removeEventListener('resize', scheduleUpdate)
})`

const userScript = `let frame = 0
let observer: ResizeObserver | undefined
function scheduleUpdate(): void {}
${userCleanup}`

function component(script: string, template = '<template><p>hola</p></template>'): string {
	return `<script lang="ts">\n${script}\n</script>\n${template}\n`
}

function codes(script: string, template?: string): string[] {
	return componentCleanupDiagnostics(component(script, template), 'D:/app/components/Panel.meeko').map((diagnostic) => diagnostic.code)
}

/** Applies the edits of a fix to the source, from the last one back. */
function apply(source: string, fix: CleanupFix): string {
	let result = source
	for (const edit of [...fix.edits].sort((left, right) => right.start - left.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
	return result
}

describe('MEEK128: onCleanup with browser APIs that also runs during SSR', () => {
	test("the user's exact case warns, at onCleanup, naming the browser globals once", () => {
		const source = component(userScript)
		const diagnostics = componentCleanupDiagnostics(source, 'D:/app/components/Panel.meeko')
		assert.equal(diagnostics.length, 1)
		const [diagnostic] = diagnostics
		assert.equal(diagnostic!.code, 'MEEK128')
		assert.equal(diagnostic!.severity, 'warning')
		assert.equal(diagnostic!.location.offset, source.indexOf('onCleanup('))
		assert.equal(diagnostic!.message, cleanupBrowserApiMessage(['cancelAnimationFrame', 'window']))
		assert.match(diagnostic!.message, /se ejecuta también en el servidor \(SSR\) y usa `cancelAnimationFrame` y `window`, que solo existen en el navegador: crea el recurso y su limpieza dentro de `onMounted`/)
		assert.match(diagnostic!.message, /https:\/\/meekojs\.com\/docs\/reference\/oncleanup/)
		assert.match(cleanupBrowserApiMessage(['window']), /usa `window`, que solo existe en el navegador/)
	})

	test('an import of onCleanup from @meekojs/meeko also warns; a local onCleanup does not', () => {
		assert.deepEqual(codes(`import { onCleanup } from "@meekojs/meeko";\n${userScript}`), ['MEEK128'])
		assert.deepEqual(codes(`import { onCleanup as release } from "@meekojs/meeko";\nrelease(() => window.scrollTo(0, 0));`), ['MEEK128'])
		assert.deepEqual(codes(`function onCleanup(release: () => void): void { release(); }\nonCleanup(() => window.scrollTo(0, 0));`), [])
	})

	test('a protected cleanup does not warn', () => {
		// typeof, as a condition, a branch, an early return or the documented import.meta.env.SSR.
		assert.deepEqual(codes(`onCleanup(() => { if (typeof window !== "undefined") window.removeEventListener("resize", update); });\nfunction update(): void {}`), [])
		assert.deepEqual(codes(`onCleanup(() => typeof window === "undefined" ? undefined : window.scrollTo(0, 0));`), [])
		assert.deepEqual(codes(`onCleanup(() => { typeof document !== "undefined" && document.body.classList.remove("open"); });`), [])
		assert.deepEqual(codes(`onCleanup(() => {\n  if (typeof window === "undefined") return;\n  window.scrollTo(0, 0);\n});`), [])
		assert.deepEqual(codes(`onCleanup(() => {\n  if (import.meta.env.SSR) return;\n  localStorage.removeItem("draft");\n});`), [])
		// The whole registration behind the check, as in the reference of onCleanup.
		assert.deepEqual(codes(`if (typeof EventSource !== "undefined") {\n  const source = new EventSource("/feed");\n  onCleanup(() => source.close());\n  onCleanup(() => window.scrollTo(0, 0));\n}`), [])
		// Only `typeof` reads the global, without a ReferenceError.
		assert.deepEqual(codes(`onCleanup(() => console.log(typeof window));`), [])
	})

	test('a cleanup inside onMounted, an event handler or a browser function does not warn', () => {
		assert.deepEqual(codes(`onMounted(() => {\n  ${userScript.replaceAll('\n', '\n  ')}\n});`), [])
		assert.deepEqual(codes(`onMounted(async () => {\n  onCleanup(() => window.scrollTo(0, 0));\n});`), [])
		assert.deepEqual(codes(`const button = { addEventListener(_: string, listener: () => void): void { listener(); } };\nbutton.addEventListener("click", () => onCleanup(() => window.scrollTo(0, 0)));`), [])
		assert.deepEqual(codes(`setTimeout(() => onCleanup(() => document.title = ""), 0);`), [])
		// A function of the setup used only as an on:* handler of the template.
		assert.deepEqual(codes(`function open(): void {\n  onCleanup(() => window.scrollTo(0, 0));\n}`, `<template><button on:click="open">Abrir</button></template>`), [])
		// After the first browser await, the setup only continues in the browser.
		assert.deepEqual(codes(`const field = await useElementRef("field");\nfield.focus();\nonCleanup(() => window.scrollTo(0, 0));`, `<template><input ref:field /></template>`), [])
	})

	test('a local variable named like a browser global, or optional chaining over a local, does not warn', () => {
		assert.deepEqual(codes(`const window = { removeEventListener(_: string): void {} };\nonCleanup(() => window.removeEventListener("resize"));`), [])
		assert.deepEqual(codes(`onCleanup(() => { const document = { title: "" }; document.title = "x"; });`), [])
		assert.deepEqual(codes(`function release(window: { close(): void }): void { onCleanup(() => window.close()); }\nrelease({ close() {} });`), [])
		assert.deepEqual(codes(`let observer: { disconnect(): void } | undefined;\nonCleanup(() => observer?.disconnect());`), [])
		// A property named like a global is not the global.
		assert.deepEqual(codes(`const view = { window: 1, history: [] as number[] };\nonCleanup(() => { view.window = 0; view.history.length = 0; });`), [])
		// Optional chaining over the global itself still throws on the server.
		assert.deepEqual(codes(`onCleanup(() => window?.scrollTo(0, 0));`), ['MEEK128'])
	})

	test('a composable or effect of the setup that runs during SSR warns', () => {
		assert.deepEqual(codes(`function useResize(update: () => void): void {\n  onCleanup(() => window.removeEventListener("resize", update));\n}\nuseResize(() => {});`), ['MEEK128'])
		assert.deepEqual(codes(`const useFrame = (): void => {\n  const frame = 0;\n  onCleanup(() => cancelAnimationFrame(frame));\n};\nuseFrame();`), ['MEEK128'])
		assert.deepEqual(codes(`effect(() => {\n  onCleanup(() => document.body.classList.remove("lock"));\n});`), ['MEEK128'])
		// A composable used only from onMounted runs in the browser.
		assert.deepEqual(codes(`function useResize(): void {\n  onCleanup(() => window.scrollTo(0, 0));\n}\nonMounted(() => useResize());`), [])
	})

	test('the browser-only globals do not exist in this Node', () => {
		for (const name of browserOnlyGlobals) assert.equal(typeof (globalThis as Record<string, unknown>)[name], 'undefined', name)
	})
})

describe('MEEK129 and MEEK130: onCleanup after an await or outside a root', () => {
	test('onCleanup after an await of its own async function warns in a component', () => {
		const source = component(`onMounted(async () => {\n  const socket = await connect();\n  onCleanup(() => socket.close());\n});\nasync function connect(): Promise<{ close(): void }> { return { close() {} }; }`)
		const diagnostics = componentCleanupDiagnostics(source, 'D:/app/components/Chat.meeko')
		assert.deepEqual(
			diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.severity, diagnostic.message]),
			[['MEEK129', 'warning', cleanupAfterAwaitMessage]],
		)
		assert.equal(diagnostics[0]!.location.offset, source.indexOf('onCleanup('))
		// Before the await, or an await of a nested function, is fine.
		assert.deepEqual(codes(`onMounted(async () => {\n  let released = false;\n  onCleanup(() => { released = true; });\n  await Promise.resolve();\n  if (released) return;\n});`), [])
		assert.deepEqual(codes(`onMounted(async () => {\n  const later = async (): Promise<void> => { await Promise.resolve(); };\n  onCleanup(() => void later());\n});`), [])
		assert.deepEqual(codes(`onMounted(async () => {\n  for await (const item of [Promise.resolve(1)]) console.log(item);\n  onCleanup(() => {});\n});`), ['MEEK129'])
	})

	test('a module that calls onCleanup while it is evaluated warns with MEEK130', () => {
		const text = `import { onCleanup } from "@meekojs/meeko";\nconst timer = setInterval(tick, 1000);\nonCleanup(() => clearInterval(timer));\nfunction tick(): void {}\n`
		const diagnostics = moduleCleanupDiagnostics(text, 'D:/app/utils/clock.ts')
		assert.deepEqual(
			diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.severity, diagnostic.message]),
			[['MEEK130', 'warning', cleanupOutsideRootMessage]],
		)
		assert.equal(diagnostics[0]!.location.offset, text.indexOf('onCleanup('))
		// Inside a block of the top level it is still module evaluation.
		assert.equal(moduleCleanupDiagnostics(`if (import.meta.hot) onCleanup(() => {});\n`, 'D:/app/utils/hot.ts')[0]?.code, 'MEEK130')
		// A composable, createRoot or a local onCleanup do not warn; an await inside a composable does.
		assert.deepEqual(moduleCleanupDiagnostics(`export function useClock(): void {\n  const timer = setInterval(() => {}, 1000);\n  onCleanup(() => clearInterval(timer));\n}\n`, 'D:/app/composables/clock.ts'), [])
		assert.deepEqual(moduleCleanupDiagnostics(`import { createRoot, onCleanup } from "@meekojs/meeko";\nexport const dispose = createRoot((dispose) => { onCleanup(() => {}); return dispose; });\n`, 'D:/app/utils/root.ts'), [])
		assert.deepEqual(moduleCleanupDiagnostics(`const onCleanup = (release: () => void): void => release();\nonCleanup(() => {});\n`, 'D:/app/utils/local.ts'), [])
		assert.deepEqual(
			moduleCleanupDiagnostics(`export async function useFeed(): Promise<void> {\n  await fetch("/feed");\n  onCleanup(() => {});\n}\n`, 'D:/app/composables/feed.ts').map((diagnostic) => diagnostic.code),
			['MEEK129'],
		)
	})
})

describe('Quick fix «Mover a `onMounted`»', () => {
	const filename = 'D:/app/components/Panel.meeko'

	test("wraps the user's cleanup in onMounted, keeping the top-level names it reads", () => {
		const source = component(userScript)
		const fixes = cleanupFixes(source, filename, source.indexOf('onCleanup('))
		assert.deepEqual(
			fixes.map((fix) => fix.title),
			['Mover a `onMounted`'],
		)
		assert.equal(
			apply(source, fixes[0]!),
			component(`let frame = 0
let observer: ResizeObserver | undefined
function scheduleUpdate(): void {}
onMounted(() => {
	onCleanup(() => {
		cancelAnimationFrame(frame)
		observer?.disconnect()
		window.removeEventListener('resize', scheduleUpdate)
		window.visualViewport?.removeEventListener('resize', scheduleUpdate)
	})
})`),
		)
		// The result no longer warns.
		assert.deepEqual(componentCleanupDiagnostics(apply(source, fixes[0]!), filename), [])
	})

	test('offers to move it into the existing onMounted, at the start of its body', () => {
		const source = component(`let frame = 0;
onMounted(async () => {
  frame = requestAnimationFrame(() => {});
  await Promise.resolve();
});
onCleanup(() => cancelAnimationFrame(frame));`)
		const fixes = cleanupFixes(source, filename, source.indexOf('onCleanup('))
		assert.deepEqual(
			fixes.map((fix) => fix.title),
			['Mover a `onMounted`', 'Mover dentro del `onMounted` existente'],
		)
		assert.equal(
			apply(source, fixes[0]!),
			component(`let frame = 0;
onMounted(async () => {
  frame = requestAnimationFrame(() => {});
  await Promise.resolve();
});
onMounted(() => {
  onCleanup(() => cancelAnimationFrame(frame));
});`),
		)
		const moved = apply(source, fixes[1]!)
		assert.equal(
			moved,
			component(`let frame = 0;
onMounted(async () => {
  onCleanup(() => cancelAnimationFrame(frame));
  frame = requestAnimationFrame(() => {});
  await Promise.resolve();
});`),
		)
		assert.deepEqual(componentCleanupDiagnostics(moved, filename), [])
	})

	test('does not move it into an onMounted that declares a name the cleanup reads', () => {
		const source = component(`let frame = 0;
onMounted(() => {
  const frame = requestAnimationFrame(() => {});
  console.log(frame);
});
onCleanup(() => cancelAnimationFrame(frame));`)
		assert.deepEqual(
			cleanupFixes(source, filename, source.indexOf('onCleanup(')).map((fix) => fix.title),
			['Mover a `onMounted`'],
		)
	})

	test('offers no fix when the cleanup is not a whole top-level statement', () => {
		const source = component(`function useResize(): void {\n  onCleanup(() => window.scrollTo(0, 0));\n}\nuseResize();`)
		assert.equal(componentCleanupDiagnostics(source, filename)[0]?.code, 'MEEK128')
		assert.deepEqual(cleanupFixes(source, filename, source.indexOf('onCleanup(')), [])
	})
})

/** Temporary project under `.meeko/` whose package imports resolve to src/. */
async function checkProject(prefix: string): Promise<string> {
	await mkdir(resolve('.meeko'), { recursive: true })
	const root = await mkdtemp(resolve('.meeko', prefix))
	await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
	await writeFile(join(root, 'tsconfig.json'), `${JSON.stringify({ compilerOptions: { types: ['node'], paths: { '@meekojs/meeko/internal': ['../../src/internal.ts'], '@meekojs/meeko': ['../../src/index.ts'] } } })}\n`)
	return root
}

test('meeko check reports MEEK128 as a warning without failing', { timeout: 120_000 }, async () => {
	const root = await checkProject('cleanup-ssr-')
	try {
		const source = component(`import { onCleanup } from "@meekojs/meeko";\n${userScript}`)
		const file = join(root, 'Panel.meeko')
		const diagnostics = await checkSource(source, file)
		assert.deepEqual(
			diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.severity]),
			[['MEEK128', 'warning']],
			JSON.stringify(diagnostics),
		)
		assert.equal(hasErrors(diagnostics), false)
		// The command prints the warning and still passes.
		const cli = resolve('dist/cli.js')
		if (existsSync(cli)) {
			await writeFile(file, source)
			const result = spawnSync(process.execPath, [cli, 'check', file], { encoding: 'utf8', windowsHide: true, timeout: 90_000 })
			assert.equal(result.status, 0, result.stderr)
			assert.match(result.stderr, /MEEK128/)
		}
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('meeko check of a project reports MEEK130 for a module of app/ without failing', { timeout: 120_000 }, async () => {
	const root = await checkProject('cleanup-module-')
	try {
		await mkdir(join(root, 'app', 'utils'), { recursive: true })
		await writeFile(join(root, 'app', 'utils', 'clock.ts'), `import { onCleanup } from "@meekojs/meeko";\nconst timer = setInterval(() => {}, 1000);\nonCleanup(() => clearInterval(timer));\n`)
		const diagnostics = await checkApp(root)
		const cleanup = diagnostics.filter((diagnostic) => diagnostic.code === 'MEEK130')
		assert.equal(cleanup.length, 1, JSON.stringify(diagnostics))
		assert.equal(cleanup[0]!.severity, 'warning')
		assert.equal(cleanup[0]!.filename, join(root, 'app', 'utils', 'clock.ts'))
		assert.equal(hasErrors(cleanup), false)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('the editor warns with MEEK128 at onCleanup and offers «Mover a `onMounted`»', { timeout: 120_000 }, async () => {
	const source = component(`import { onCleanup } from "@meekojs/meeko";\n${userScript}`)
	const workspace = await languageProject('lsp-cleanup-', { 'Panel.meeko': source })
	try {
		const context = await workspace.open('Panel.meeko')
		const diagnostics = await componentDiagnostics(workspace.project, context.document, workspace.file('Panel.meeko'), () => undefined)
		const cleanup = diagnostics.filter((item) => item.code === 'MEEK128')
		assert.deepEqual(
			cleanup.map((item) => [item.severity, context.document.getText(item.range)]),
			[[DiagnosticSeverity.Warning, 'onCleanup']],
			JSON.stringify(diagnostics),
		)
		const actions = cleanupActions(context.document, cleanup)
		assert.deepEqual(
			actions.map((action) => [action.title, action.isPreferred]),
			[['Mover a `onMounted`', true]],
		)
		const [edit] = Object.values(actions[0]!.edit!.changes!)[0]!
		assert.match(edit!.newText, /^onMounted\(\(\) => \{\n\tonCleanup\(\(\) => \{/)
	} finally {
		await workspace.dispose()
	}
})
