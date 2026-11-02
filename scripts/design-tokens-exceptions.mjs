// Images and effects are the only thing an application may do differently from packages/ui. Each entry
// covers one rule and one exact value of one file, with its reason; there are no wildcards, and an entry
// that nothing uses makes scripts/design-tokens-check.mjs fail.
export const designExceptions = [
	{
		file: 'apps/meeko/app/styles/main.css',
		rule: 'font',
		value: 'font: var(--ui-font-weight-medium) var(--fig-text, 9px) var(--ui-font-mono)',
		reason: 'Image: the labels of the isometric drawings (.iso text) are sized in the units of each SVG viewBox, which no rem token can express.',
	},
]
