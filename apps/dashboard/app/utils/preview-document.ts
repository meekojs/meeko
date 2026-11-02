// The document of the preview's iframe. The render keeps the raw HTML of the Markdown, as the site
// does, so a draft can carry <style>, <iframe>, <script> or on* attributes: it is shown in an
// <iframe sandbox srcdoc> without allow-scripts or allow-same-origin, an opaque origin that cannot
// run anything nor reach the dashboard's document. It is dressed with the sheets of @meekojs/ui that the
// site uses (app/utils/preview-styles.ts), on the values of the --ui-* tokens that the dashboard reads
// from its own root when it builds the document, so both themes stay faithful. Inter loads inside it:
// @meekojs/ui serves the font with CORS, which an opaque origin needs, and the font-src 'self' that the
// iframe inherits names the origin of the dashboard.

/** The root size of the page, with its fluid scale: the rem of the tokens measure the same inside. */
const rootSize = '--dash-preview-root-size'

/** The page around the prose: what the Shell of a site gives it, and what only the iframe needs. */
export const previewPageStyles = `
*, ::before, ::after {
	box-sizing: border-box;
}
html {
	background: var(--ui-color-bg);
	font-size: var(${rootSize}, 100%);
}
body.dash-preview {
	--ui-prose-width: none;
	margin: 0;
	background: var(--ui-color-bg);
	padding: var(--ui-space-6) var(--ui-space-8);
	-webkit-font-smoothing: antialiased;
}
/* The copy button needs the script of the site: in the preview only its label stays. */
.dash-preview .code-copy {
	display: none;
}
@media (max-width: 35rem) {
	body.dash-preview {
		padding: var(--ui-space-4);
	}
}
`

/**
 * Policy of the document inside the iframe, on top of the dashboard's, which it inherits: nothing
 * runs, frames, posts forms or changes the base URL, whatever the draft says.
 */
export const previewPolicy = "script-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'"

/** The custom properties that some styles read, such as `--ui-color-bg` and `--ui-font-mono`. */
export function previewTokens(styles: string): readonly string[] {
	return [...new Set([...`${previewPageStyles}${styles}`.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]!))]
}

const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** A value a custom property can hold here without closing its rule or the `<style>`. */
const safeToken = (value: string): boolean => !/[;{}<]/.test(value)

/**
 * The `srcdoc` of the preview: the render's HTML in a document with the policy, the theme, the styles and
 * the values of {@link previewTokens}, as {@link readPreviewTokens} reads them from the dashboard.
 */
export function previewDocument(input: { readonly html: string; readonly theme: 'dark' | 'light'; readonly styles: string; readonly tokens: Readonly<Record<string, string>> }): string {
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
		`<style>:root { color-scheme: ${input.theme}; ${tokens} }${input.styles}${previewPageStyles}</style>`,
		'</head>',
		'<body class="dash-preview meeko-ui-prose">',
		input.html,
		'</body>',
		'</html>',
	].join('\n')
}

/** The values of the tokens that `styles` reads on `root` now, in the browser, and its root size. */
export function readPreviewTokens(root: Element, styles: string): Record<string, string> {
	const style = getComputedStyle(root)
	return { ...Object.fromEntries(previewTokens(styles).map((name) => [name, style.getPropertyValue(name)])), [rootSize]: style.fontSize }
}
