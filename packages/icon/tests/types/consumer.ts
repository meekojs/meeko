import type { IconInclude, IconName, IconProps } from '@meekojs/icon'
import type { IconModuleOptions } from '@meekojs/icon/module'
import type { MeekoConfig } from '@meekojs/meeko/framework'

// What .meeko/types/modules/%40meekojs%2Ficon/*.d.ts declares for a project with Lucide and app/icons.
declare module '@meekojs/icon' {
	interface GeneratedIconNames {
		'local:logo': true
		'lucide:search': true
		'lucide:trash-2': true
	}
	interface GeneratedIconCollections {
		lucide: true
	}
}

const search: IconName = 'lucide:search'
const logo: IconName = 'local:logo'
// @ts-expect-error A name outside the generated union is an error.
const typo: IconName = 'lucide:serch'
// @ts-expect-error A plain string is not an icon name.
const loose: IconName = 'search' as string

const props: IconProps = { name: 'lucide:trash-2', label: 'Eliminar', size: '20px' }
// @ts-expect-error The name prop is typed with the generated union.
const wrongProps: IconProps = { name: 'mdi:home' }

const include: IconInclude[] = ['lucide:search', 'lucide:*', 'local:logo']
// @ts-expect-error include is typed with the icon names too.
const wrongInclude: IconInclude[] = ['lucide:serch']

// The `icon` key of meeko.config.ts, from the module's augmentation of MeekoConfig.
const config: MeekoConfig = { modules: ['@meekojs/icon'], icon: { collections: ['lucide'], include: ['lucide:search'], local: 'app/icons', size: '1.25em' } }
// @ts-expect-error An unknown option of the key.
const unknownOption: MeekoConfig = { icon: { colections: ['lucide'] } }
// @ts-expect-error size is a string.
const wrongSize: IconModuleOptions = { size: 20 }
// @ts-expect-error include entries are checked in the configuration.
const wrongConfigInclude: MeekoConfig = { icon: { include: ['lucide:nope'] } }

export { config, include, logo, loose, props, search, typo, unknownOption, wrongConfigInclude, wrongInclude, wrongProps, wrongSize }
