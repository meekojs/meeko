// A preview worker without the render, for the tests of server/dashboard/preview.ts: it answers each
// message at once, or as the Markdown asks (`slow`, `crash`, `fail`), with the guard of the real one.
import { exitWithParent } from '../../scripts/parent-guard.mjs'

exitWithParent({ keepAlive: true })
console.log(`pid:${process.pid}`)
process.on('message', async ({ id, file, kind, markdown }) => {
	if (markdown === 'crash') process.exit(1)
	if (markdown === 'slow') await new Promise((resolve) => setTimeout(resolve, 1500))
	const rss = Number(process.env.FAKE_RSS ?? 1)
	if (markdown === 'fail') return process.send({ id, ok: false, error: `${file} is not a guide of the site`, rss })
	process.send({ id, ok: true, rss, result: { title: markdown, description: kind, html: `<p>${markdown}</p>`, toc: [], complete: true, issues: [], durationMs: 1 } })
})
process.send({ ready: true })
