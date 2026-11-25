import type { VariantProps } from 'tailwind-variants/lite'

import type { buttonTheme } from '../theme/components/button'
import type { cardTheme, linkCardTheme } from '../theme/components/card'
import type { copyButtonTheme } from '../theme/components/copy-button'
import type { iconButtonTheme } from '../theme/components/icon-button'
import type { avatar } from '../variants/avatar'
import type { badge } from '../variants/badge'
import type { checkbox, radioGroup, segmentedControl, toggle } from '../variants/choice'
import type { commandPalette } from '../variants/command-palette'
import type { container } from '../variants/container'
import type { codeBlock, diff } from '../variants/content'
import type { descriptionList, sparkline, stat } from '../variants/data'
import type { drawer } from '../variants/drawer'
import type { alert, disclosure, empty, skeleton, toast } from '../variants/feedback'
import type { field } from '../variants/field'
import type { footer, header } from '../variants/header'
import type { input, textarea } from '../variants/input'
import type { localeSuggestion, localeSwitcher } from '../variants/locale'
import type { markdownEditor } from '../variants/markdown-editor'
import type { menu } from '../variants/menu'
import type { modal } from '../variants/modal'
import type { breadcrumb, navigationTabs, navigationTree, pageNavigation, pagination, tableOfContents } from '../variants/navigation'
import type { page, pageHeader } from '../variants/page'
import type { hint } from '../variants/popover'
import type { combobox, select } from '../variants/select'
import type { slider } from '../variants/slider'
import type { table } from '../variants/table'
import type { tabs } from '../variants/tabs'
import type { themeToggle } from '../variants/theme-toggle'
import type { UIDensity } from './forms'
import type { UIMessageOverrides } from './messages'
import type { UIVariantSlots } from './theme'

/** Aplana una intersección para que el editor muestre las claves como un solo objeto. */
type Simplify<T> = { [K in keyof T]: T[K] } & {}

/**
 * Dónde van las acciones de una `UICard` respecto a su título: `inline` a su lado, `below` siempre debajo y
 * `auto` debajo cuando la cabecera de la card es estrecha.
 *
 * @since 1.10.0
 * @example `<UICard title="Pedidos" actionsWrap="auto">…</UICard>`
 */
export type UICardActionsWrap = 'inline' | 'below' | 'auto'

/**
 * Lo que `ui.defaults` acepta para un componente: `class`, que se suma a la de cada instancia; `ui`, con
 * clases por slot (los de su `tv()`), si el componente tiene varias partes; y, en algunos componentes, el
 * valor de base de ciertas variantes (`V`). `T` es la función que devuelve `tv()`; un componente sin ella
 * (`UIProse`, `UITooltip`) sólo admite `class`.
 *
 * @since 1.10.0
 * @example
 * ```ts
 * import type { stat } from '../variants/data'
 *
 * type StatDefaults = UIComponentDefaults<typeof stat> // { class?: string; ui?: { base?, label?, value?, detail?, change?, … } }
 * ```
 */
export type UIComponentDefaults<T extends ((...args: never[]) => unknown) | undefined = undefined, V = {}> = Simplify<
	{
		/** Clases que se suman a las de cada instancia en su elemento raíz (allí donde llega su `class`). */
		readonly class?: string
	} & (T extends (...args: never[]) => unknown ? Readonly<UIVariantSlots<T>> : {}) &
		Readonly<V>
>

/** Las variantes de botón que admiten un valor por aplicación: tratamiento, color, tamaño y radio. */
type UIActionChoices = 'color' | 'radius' | 'size' | 'variant'

/** Las variantes de una card enlazada que admiten un valor por aplicación: tratamiento, color, radio y sombra. */
type UILinkCardChoices = 'color' | 'elevation' | 'radius' | 'variant'

/** Las variantes de `UICard` que admiten un valor por aplicación: las de `UILinkCard` y el padding. */
type UICardChoices = 'padding' | UILinkCardChoices

/** Variantes de una acción (`UIButton`, `UILink`) que admiten un valor por aplicación. */
type UIActionDefaults = UIComponentDefaults<typeof buttonTheme, Pick<VariantProps<typeof buttonTheme>, UIActionChoices>>

/**
 * Valores por defecto por aplicación, por componente: la clave es su nombre en camelCase sin el prefijo
 * (`card` es `UICard`, `descriptionList` es `UIDescriptionList`). Cada componente que acepta `class` o `ui`
 * admite aquí las dos, que **se suman** a las de cada instancia: primero las del componente, después las de
 * `ui.defaults` y al final las de la instancia, sin fusionarlas. En un conflicto decide la cascada: las
 * reglas sin capa de la aplicación ganan a las de UI.
 *
 * Además, unas pocas variantes de apariencia general admiten un valor de base: `variant`, `color`, `size` y
 * `radius` en `button`, `link`, `iconButton` y `copyButton`; `size` y `shape` en `avatar`; `variant`, `color`, `radius`, `elevation`, `padding`, `density` y `actionsWrap` en `card`; `variant`, `color`, `radius` y `elevation` en `linkCard`; `size` en `segmentedControl`, y `density` en `table`. La
 * prop explícita de la instancia gana siempre.
 *
 * @since 1.10.0 acepta `class` y `ui` en cada componente, y `padding`, `density`, `actionsWrap` en `card` y
 * `density` en `table`. Antes sólo admitía las variantes de `button`, `link` y `card`.
 * @example
 * ```ts
 * export default defineMeekoConfig({
 * 	modules: ['@meekojs/ui'],
 * 	ui: {
 * 		defaults: {
 * 			card: { padding: 'sm', ui: { header: 'panel-card-header' } },
 * 			table: { density: 'compact', class: 'panel-table' },
 * 			stat: { ui: { value: 'panel-stat-value' } },
 * 		},
 * 	},
 * })
 * ```
 */
export interface UIDefaults {
	readonly alert?: UIComponentDefaults<typeof alert>
	/**
	 * `UIAvatar`: `class` llega a la caja, y `size` y `shape` son sus valores de base.
	 *
	 * @since 1.10.0
	 */
	readonly avatar?: UIComponentDefaults<typeof avatar, Pick<VariantProps<typeof avatar>, 'shape' | 'size'>>
	readonly badge?: UIComponentDefaults<typeof badge>
	readonly breadcrumb?: UIComponentDefaults<typeof breadcrumb>
	readonly button?: UIActionDefaults
	/** `UICard`: `variant`, `color`, `radius`, `elevation` y `padding` son valores de base de su receta (`cardTheme`). */
	readonly card?: UIComponentDefaults<
		typeof cardTheme,
		Pick<VariantProps<typeof cardTheme>, UICardChoices> & {
			/** Densidad de base; un `padding` de `ui.defaults` o de la instancia gana sobre ella. */
			readonly density?: UIDensity
			/**
			 * Posición de base de las acciones; la prop `actionsWrap` de la instancia gana sobre ella.
			 *
			 * @since 1.10.0
			 */
			readonly actionsWrap?: UICardActionsWrap
		}
	>
	readonly checkbox?: UIComponentDefaults<typeof checkbox>
	readonly codeBlock?: UIComponentDefaults<typeof codeBlock>
	readonly combobox?: UIComponentDefaults<typeof combobox>
	readonly commandPalette?: UIComponentDefaults<typeof commandPalette>
	readonly container?: UIComponentDefaults<typeof container>
	/**
	 * `UICopyButton`: `class` llega al botón, y `variant`, `color`, `size` y `radius` son sus valores de base.
	 *
	 * @since 1.10.0
	 */
	readonly copyButton?: UIComponentDefaults<typeof copyButtonTheme, Pick<VariantProps<typeof copyButtonTheme>, UIActionChoices>>
	readonly descriptionList?: UIComponentDefaults<typeof descriptionList>
	readonly diff?: UIComponentDefaults<typeof diff>
	readonly disclosure?: UIComponentDefaults<typeof disclosure>
	readonly drawer?: UIComponentDefaults<typeof drawer>
	readonly empty?: UIComponentDefaults<typeof empty>
	readonly field?: UIComponentDefaults<typeof field>
	readonly footer?: UIComponentDefaults<typeof footer>
	readonly header?: UIComponentDefaults<typeof header>
	/**
	 * `UIHint`: `class` llega al botón, como la prop de la instancia.
	 *
	 * @since 1.10.0
	 */
	readonly hint?: UIComponentDefaults<typeof hint>
	/**
	 * `UIIconButton`: `class` llega al botón o al enlace, y `variant`, `color`, `size` y `radius` son sus valores de base.
	 *
	 * @since 1.10.0
	 */
	readonly iconButton?: UIComponentDefaults<typeof iconButtonTheme, Pick<VariantProps<typeof iconButtonTheme>, UIActionChoices>>
	readonly input?: UIComponentDefaults<typeof input>
	readonly link?: UIActionDefaults
	/** `UILinkCard`: `variant`, `color`, `radius` y `elevation` son valores de base de su receta (`linkCardTheme`). */
	readonly linkCard?: UIComponentDefaults<typeof linkCardTheme, Pick<VariantProps<typeof linkCardTheme>, UILinkCardChoices>>
	readonly localeSuggestion?: UIComponentDefaults<typeof localeSuggestion>
	readonly localeSwitcher?: UIComponentDefaults<typeof localeSwitcher>
	/** `UIMarkdownEditor`, del módulo `@meekojs/ui/editor`. */
	readonly markdownEditor?: UIComponentDefaults<typeof markdownEditor>
	/**
	 * `class` llega a la lista del menú, como la prop de la instancia.
	 *
	 * @since 1.10.0
	 */
	readonly menu?: UIComponentDefaults<typeof menu>
	readonly modal?: UIComponentDefaults<typeof modal>
	readonly navigationTabs?: UIComponentDefaults<typeof navigationTabs>
	readonly navigationTree?: UIComponentDefaults<typeof navigationTree>
	readonly page?: UIComponentDefaults<typeof page>
	readonly pageHeader?: UIComponentDefaults<typeof pageHeader>
	readonly pageNavigation?: UIComponentDefaults<typeof pageNavigation>
	readonly pagination?: UIComponentDefaults<typeof pagination>
	/** `class` llega al contenido del popover, como la prop de la instancia. */
	readonly popover?: UIComponentDefaults
	readonly prose?: UIComponentDefaults
	readonly radioGroup?: UIComponentDefaults<typeof radioGroup>
	/**
	 * `size` de base; la prop de la instancia gana sobre él.
	 *
	 * @since 1.10.0
	 */
	readonly segmentedControl?: UIComponentDefaults<typeof segmentedControl, Pick<VariantProps<typeof segmentedControl>, 'size'>>
	readonly select?: UIComponentDefaults<typeof select>
	readonly skeleton?: UIComponentDefaults<typeof skeleton>
	readonly slider?: UIComponentDefaults<typeof slider>
	/**
	 * `UISparkline`, también el de `UIStat trend`: `class` llega al `<svg>`, y `ui` a `base`, `area` y `line`.
	 *
	 * @since 1.10.0
	 */
	readonly sparkline?: UIComponentDefaults<typeof sparkline>
	readonly stat?: UIComponentDefaults<typeof stat>
	readonly switch?: UIComponentDefaults<typeof toggle>
	/** `class` llega a la `<table>`, como la prop de la instancia; el contenedor es `ui.base`. */
	readonly table?: UIComponentDefaults<typeof table, Pick<VariantProps<typeof table>, 'density'>>
	readonly tableOfContents?: UIComponentDefaults<typeof tableOfContents>
	readonly tabs?: UIComponentDefaults<typeof tabs>
	readonly textarea?: UIComponentDefaults<typeof textarea>
	readonly themeToggle?: UIComponentDefaults<typeof themeToggle>
	/** Sólo `ui`: un `UIToast` no recibe `class`. También se aplica a los avisos de `useToast()`. */
	readonly toast?: Omit<UIComponentDefaults<typeof toast>, 'class'>
	readonly tooltip?: UIComponentDefaults
}

/**
 * Sustituciones de los tokens `--ui-*` para una aplicación; admiten valores CSS o referencias a sus
 * variables. `packages/ui/DESIGN.md` explica cada token.
 *
 * @example
 * ```ts
 * export default defineMeekoConfig({
 * 	modules: ['@meekojs/ui'],
 * 	ui: { tokens: { primary: 'var(--brand)', radius: '0.5rem' } },
 * })
 * ```
 */
export interface UITokens {
	readonly primary?: string
	readonly primaryHover?: string
	readonly onPrimary?: string
	readonly surface?: string
	readonly surfaceHover?: string
	readonly text?: string
	readonly textSoft?: string
	readonly muted?: string
	readonly border?: string
	readonly borderStrong?: string
	readonly controlPadding?: string
	readonly danger?: string
	readonly focus?: string
	readonly radius?: string
	readonly font?: string
	readonly controlHeight?: string
	readonly controlWeight?: string
	readonly controlFontSize?: string
	readonly accentSoft?: string
	readonly accentText?: string
}

/** Configuración del módulo UI en `meeko.config.ts`. */
export interface UIOptions {
	readonly tokens?: UITokens
	readonly defaults?: UIDefaults
	/**
	 * Carga la base global de UI: reset, `body`, selección y foco, en la capa `ui-base`, que cualquier
	 * regla sin capa de la aplicación sobrescribe. `true` por defecto; `false` la omite y la aplicación
	 * escribe la suya.
	 */
	readonly base?: boolean
	/**
	 * Idioma de los textos propios de los componentes sin `@meekojs/i18n` (`"es"` por defecto). Con
	 * ese módulo manda el idioma del documento y éste es el respaldo de un idioma sin textos.
	 */
	readonly locale?: string
	/** Textos por idioma: sobrescriben los del paquete (`es`, `en`) o añaden otros idiomas. */
	readonly messages?: Readonly<Record<string, UIMessageOverrides>>
}
