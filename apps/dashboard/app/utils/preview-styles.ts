// What the iframe of the preview loads: the sheets of @meekojs/ui that dress a snapshot, the same the site
// serves, as text. Its own document cannot reach the dashboard's styles, and a copy would drift.
import code from '@meekojs/ui/styles/code.css?raw'
import fonts from '@meekojs/ui/styles/fonts.css?raw'
import prose from '@meekojs/ui/styles/prose.css?raw'

/** The reading styles of the site, for the document of the preview. */
export const previewStyles = `${fonts}\n${code}\n${prose}`
