import type { MeekoPrettierOptions } from '@meekojs/prettier-plugin'

import { type Config } from 'prettier'

const config: Config &
	MeekoPrettierOptions & {
		cssDeclarationSorterKeepOverrides: boolean
		cssDeclarationSorterOrder: 'concentric-css'
	} = {
	plugins: ['@meekojs/prettier-plugin', 'prettier-plugin-css-order', 'prettier-plugin-packagejson'],
	cssDeclarationSorterKeepOverrides: false,
	cssDeclarationSorterOrder: 'concentric-css',
	endOfLine: 'auto',
	htmlWhitespaceSensitivity: 'ignore',
	meekoIndentSections: true,
	printWidth: 800,
	semi: false,
	singleAttributePerLine: true,
	singleQuote: true,
	tabWidth: 2,
	useTabs: true,
}

export default config
