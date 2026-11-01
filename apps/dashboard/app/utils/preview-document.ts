// The document of the preview's iframe. The render keeps the raw HTML of the Markdown, as the site
// does, so a draft can carry <style>, <iframe>, <script> or on* attributes: it is shown in an
// <iframe sandbox srcdoc> without allow-scripts or allow-same-origin, an opaque origin that cannot
// run anything nor reach the dashboard's document. Its styles live here, inside that document: the
// prose rules of apps/meeko/app/styles/main.css on the tokens of packages/docs, whose values the
// dashboard reads from its own root when it builds the document, so both themes stay faithful.
// Inter is not loaded inside it (a font from an opaque origin needs CORS): the system font stands in.

/** The prose rules of the site, for `<body class="dash-preview prose">` inside the iframe. */
export const previewStyles = `
html {
	background: var(--bg);
}
body.dash-preview {
	margin: 0;
	background: var(--bg);
	padding: 1.5rem 1.75rem;
	font-family: var(--font-ui);
	-webkit-font-smoothing: antialiased;
}
.dash-preview.prose {
	max-width: none;
	color: var(--ink-soft);
	font-size: 1rem;
	line-height: 1.72;
	overflow-wrap: break-word;
}
.dash-preview > :first-child {
	margin-top: 0;
}
.dash-preview > :is(p, ul, ol, dl, blockquote, h1, h2, h3, h4, hr) {
	max-width: 40rem;
}
.dash-preview :is(h1, h2, h3, h4) {
	position: relative;
	color: var(--ink);
	font-family: var(--font-display);
	text-wrap: balance;
}
.dash-preview h1 {
	margin: 0 0 1.1rem;
	font-weight: var(--weight-display);
	font-size: 2rem;
	line-height: 1.1;
	letter-spacing: var(--tracking-display);
}
.dash-preview h2 {
	margin: 2.5rem 0 0.85rem;
	font-weight: 560;
	font-size: 1.375rem;
	line-height: 1.25;
	letter-spacing: -0.022em;
}
.dash-preview h3 {
	margin: 2rem 0 0.6rem;
	font-weight: 580;
	font-size: 1.125rem;
	line-height: 1.35;
}
.dash-preview h4 {
	margin: 1.7rem 0 0.5rem;
	font-weight: 600;
	font-size: 1rem;
}
.dash-preview :is(h2, h3, h4) code {
	font-size: 0.86em;
}
.dash-preview .heading-anchor {
	opacity: 0;
	margin-left: 0.45rem;
	color: var(--muted);
	font-weight: 400;
	text-decoration: none;
}
.dash-preview :is(h2, h3, h4):hover .heading-anchor,
.dash-preview .heading-anchor:focus-visible {
	opacity: 1;
}
.dash-preview :is(p, ul, ol, blockquote, dl) {
	margin: 0 0 1.15rem;
}
.dash-preview :is(ul, ol) {
	padding-left: 1.3rem;
}
.dash-preview li {
	margin: 0.35rem 0;
	padding-left: 0.2rem;
}
.dash-preview li::marker {
	color: var(--muted);
}
.dash-preview strong {
	color: var(--ink);
	font-weight: 600;
}
.dash-preview a {
	color: var(--accent-ink);
	text-decoration-color: var(--accent-line);
	text-underline-offset: 0.2em;
}
.dash-preview a:hover {
	text-decoration-color: currentColor;
}
.dash-preview blockquote {
	border: 1px solid var(--line);
	border-radius: var(--radius);
	background: var(--surface);
	padding: 0.85rem 1.1rem;
}
.dash-preview hr {
	margin: 2.5rem 0;
	border: 0;
	border-top: 1px solid var(--line);
}
.dash-preview img {
	max-width: 100%;
	height: auto;
}
.dash-preview :not(pre) > code {
	border-radius: 4px;
	background: color-mix(in oklab, var(--surface-2) 55%, transparent);
	padding: 0.1em 0.32em;
	color: var(--ink-soft);
	font-weight: 350;
	font-size: 0.82em;
	overflow-wrap: anywhere;
}
.dash-preview a > code {
	color: var(--accent-ink);
}
.dash-preview .table-wrap {
	margin: 0 0 1.5rem;
	border: 1px solid var(--line);
	border-radius: var(--radius);
	overflow-x: auto;
}
.dash-preview table {
	border-collapse: collapse;
	width: 100%;
	font-size: 0.875rem;
	line-height: 1.55;
	font-variant-numeric: tabular-nums;
}
.dash-preview :is(th, td) {
	vertical-align: top;
	border-bottom: 1px solid var(--line);
	padding: 0.55rem 0.8rem;
	text-align: left;
}
.dash-preview th {
	background: var(--surface);
	color: var(--ink);
	font-weight: 560;
	font-size: 0.8125rem;
	white-space: nowrap;
}
.dash-preview tr:last-child td {
	border-bottom: 0;
}
.dash-preview .code-block {
	margin: 0 0 1.5rem;
	border: 1px solid var(--code-line);
	border-radius: var(--radius);
	background: var(--code-bg);
	overflow: hidden;
}
.dash-preview .code-head {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 1rem;
	border-bottom: 1px solid var(--code-line);
	padding: 0.3rem 0.4rem 0.3rem 0.9rem;
	min-height: 2.2rem;
	color: var(--muted);
	font: 500 0.72rem/1.6 var(--font-mono);
	letter-spacing: 0.04em;
}
/* The copy button needs the script of the site: in the preview only its label stays. */
.dash-preview .code-copy {
	display: none;
}
.dash-preview .code-verdict {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	margin-right: auto;
	font: 560 0.75rem/1.5 var(--font-ui);
	letter-spacing: 0;
}
.dash-preview .code-verdict svg,
.dash-preview .callout-title svg {
	flex: none;
	fill: none;
	stroke: currentColor;
	stroke-linecap: round;
	stroke-linejoin: round;
	stroke-width: 1.6;
	width: 14px;
	height: 14px;
}
.dash-preview .code-block[data-verdict='good'] .code-head {
	background: color-mix(in oklab, var(--success) 7%, transparent);
	color: var(--success);
}
.dash-preview .code-block[data-verdict='bad'] .code-head {
	background: color-mix(in oklab, var(--danger) 7%, transparent);
	color: var(--danger);
}
.dash-preview .shiki {
	margin: 0;
	background: transparent !important;
	padding: 0.9rem 1.05rem;
	overflow-x: auto;
	font-size: 0.8125rem;
	line-height: 1.7;
	tab-size: 2;
}
.dash-preview .shiki code {
	font-family: var(--font-mono);
	font-variant-ligatures: none;
}
.dash-preview .shiki span {
	color: var(--shiki-dark);
}
:root[data-theme='light'] .dash-preview .shiki span {
	color: var(--shiki-light);
}
.dash-preview .callout {
	margin: 0 0 1.5rem;
	border: 1px solid var(--line);
	border-radius: var(--radius);
	background: var(--surface);
	padding: 0.8rem 1.05rem;
	font-size: 0.95rem;
}
.dash-preview .callout > :last-child {
	margin-bottom: 0;
}
.dash-preview .callout-title {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	margin: 0 0 0.35rem;
	color: var(--accent-ink);
	font-weight: 560;
	font-size: 0.86rem;
}
.dash-preview :is(.callout-warning, .callout-caution) {
	border-color: color-mix(in oklab, var(--danger) 34%, var(--line));
	background: color-mix(in oklab, var(--danger) 5%, var(--surface));
}
.dash-preview :is(.callout-warning, .callout-caution) .callout-title {
	color: var(--danger);
}
.dash-preview .type-of {
	margin: 0 0 0.4rem;
	font-size: 0.85rem;
}
.dash-preview .related-list {
	padding-left: 1.1rem;
}
.dash-preview .related-note {
	display: block;
	color: var(--muted);
	font-size: 0.875rem;
}
@media (max-width: 560px) {
	body.dash-preview {
		padding: 1rem;
	}
}
`

/**
 * Policy of the document inside the iframe, on top of the dashboard's, which it inherits: nothing
 * runs, frames, posts forms or changes the base URL, whatever the draft says.
 */
export const previewPolicy = "script-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'"

/** The custom properties that {@link previewStyles} uses, such as `--bg` and `--font-mono`. */
export const previewTokens: readonly string[] = [...new Set([...previewStyles.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]!))]

const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** A value a custom property can hold here without closing its rule or the `<style>`. */
const safeToken = (value: string): boolean => !/[;{}<]/.test(value)

/**
 * The `srcdoc` of the preview: the render's HTML in a document with the policy, the theme and the
 * values of {@link previewTokens}, as {@link readPreviewTokens} reads them from the dashboard.
 */
export function previewDocument(input: { readonly html: string; readonly theme: 'dark' | 'light'; readonly tokens: Readonly<Record<string, string>> }): string {
	const tokens = Object.entries(input.tokens)
		.filter(([name, value]) => /^--[a-z0-9-]+$/.test(name) && value.trim() !== '' && safeToken(value))
		.map(([name, value]) => `${name}: ${value.trim()};`)
		.join(' ')
	return [
		'<!doctype html>',
		`<html lang="es" data-theme="${input.theme}">`,
		'<head>',
		'<meta charset="utf-8">',
		`<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(previewPolicy)}">`,
		'<meta name="referrer" content="no-referrer">',
		`<style>:root { color-scheme: ${input.theme}; ${tokens} }${previewStyles}</style>`,
		'</head>',
		'<body class="dash-preview prose">',
		input.html,
		'</body>',
		'</html>',
	].join('\n')
}

/** The values of {@link previewTokens} on `root` now, in the browser. */
export function readPreviewTokens(root: Element): Record<string, string> {
	const style = getComputedStyle(root)
	return Object.fromEntries(previewTokens.map((name) => [name, style.getPropertyValue(name)]))
}
