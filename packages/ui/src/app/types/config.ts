import type { VariantProps } from 'tailwind-variants/lite'

import type { alertTheme } from '../theme/components/alert'
import type { avatarTheme } from '../theme/components/avatar'
import type { badgeTheme } from '../theme/components/badge'
import type { buttonTheme } from '../theme/components/button'
import type { cardTheme, linkCardTheme } from '../theme/components/card'
import type { checkboxTheme } from '../theme/components/checkbox'
import type { codeBlockTheme } from '../theme/components/code-block'
import type { comboboxTheme } from '../theme/components/combobox'
import type { commandPaletteTheme } from '../theme/components/command-palette'
import type { containerTheme } from '../theme/components/container'
import type { copyButtonTheme } from '../theme/components/copy-button'
import type { dateRangeTheme } from '../theme/components/date-range'
import type { descriptionListTheme } from '../theme/components/description-list'
import type { diffTheme } from '../theme/components/diff'
import type { disclosureTheme } from '../theme/components/disclosure'
import type { drawerTheme } from '../theme/components/drawer'
import type { emptyTheme } from '../theme/components/empty'
import type { fieldTheme } from '../theme/components/field'
import type { footerTheme, headerTheme } from '../theme/components/header'
import type { hintTheme } from '../theme/components/hint'
import type { iconButtonTheme } from '../theme/components/icon-button'
import type { inputTheme } from '../theme/components/input'
import type { localeSuggestionTheme, localeSwitcherTheme } from '../theme/components/locale'
import type { markdownEditorTheme } from '../theme/components/markdown-editor'
import type { menuTheme } from '../theme/components/menu'
import type { modalTheme } from '../theme/components/modal'
import type { breadcrumbTheme, navigationTabsTheme, navigationTreeTheme, pageNavigationTheme, paginationTheme, tableOfContentsTheme } from '../theme/components/navigation'
import type { pageHeaderTheme, pageTheme } from '../theme/components/page'
import type { radioGroupTheme } from '../theme/components/radio-group'
import type { segmentedControlTheme } from '../theme/components/segmented-control'
import type { selectTheme } from '../theme/components/select'
import type { skeletonTheme } from '../theme/components/skeleton'
import type { sliderTheme } from '../theme/components/slider'
import type { sparklineTheme } from '../theme/components/sparkline'
import type { statTheme } from '../theme/components/stat'
import type { switchTheme } from '../theme/components/switch'
import type { tableTheme } from '../theme/components/table'
import type { tabsTheme } from '../theme/components/tabs'
import type { textareaTheme } from '../theme/components/textarea'
import type { themeToggleTheme } from '../theme/components/theme-toggle'
import type { toastTheme } from '../theme/components/toast'
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
 * import type { statTheme } from '../theme/components/stat'
 *
 * type StatDefaults = UIComponentDefaults<typeof statTheme> // { class?: string; ui?: { base?, label?, value?, detail?, change?, … } }
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
 * `radius` en `button`, `link`, `iconButton`, `copyButton` e `input`; `size`, `variant`, `color` y `radius` en
 * `avatar`; `variant`, `color` y `radius` en `badge`; `variant`, `color`, `radius`, `elevation`, `padding`,
 * `density` y `actionsWrap` en `card`; `variant`, `color`, `radius` y `elevation` en `linkCard`; `size` en
 * `segmentedControl`, y `density` en `table`. La prop explícita de la instancia gana siempre. Los mensajes
 * (`alert`, `toast`) toman `variant` y `color` sólo por instancia.
 *
 * @since 1.10.0 acepta `class` y `ui` en cada componente, y `padding`, `density`, `actionsWrap` en `card` y
 * `density` en `table`. Antes sólo admitía las variantes de `button`, `link` y `card`.
 * @since 1.12.0 acepta `variant`, `color`, `size` y `radius` en `input`, `variant`, `color` y `radius` en
 * `badge` y `avatar` (que deja `shape`), y ya no `appearance` ni `tone`.
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
	readonly alert?: UIComponentDefaults<typeof alertTheme>
	/**
	 * `UIAvatar`: `class` llega a la caja, y `size`, `variant`, `color` y `radius` son sus valores de base.
	 *
	 * @since 1.10.0
	 * @since 1.12.0 `variant`, `color` y `radius` sustituyen a `shape`.
	 */
	readonly avatar?: UIComponentDefaults<typeof avatarTheme, Pick<VariantProps<typeof avatarTheme>, 'color' | 'radius' | 'size' | 'variant'>>
	/**
	 * `UIBadge`: `class` llega a la etiqueta, y `variant`, `color` y `radius` son sus valores de base.
	 *
	 * @since 1.12.0 `variant`, `color` y `radius`.
	 */
	readonly badge?: UIComponentDefaults<typeof badgeTheme, Pick<VariantProps<typeof badgeTheme>, 'color' | 'radius' | 'variant'>>
	readonly breadcrumb?: UIComponentDefaults<typeof breadcrumbTheme>
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
	readonly checkbox?: UIComponentDefaults<typeof checkboxTheme>
	readonly codeBlock?: UIComponentDefaults<typeof codeBlockTheme>
	readonly combobox?: UIComponentDefaults<typeof comboboxTheme>
	readonly commandPalette?: UIComponentDefaults<typeof commandPaletteTheme>
	readonly container?: UIComponentDefaults<typeof containerTheme>
	/**
	 * `UICopyButton`: `class` llega al botón, y `variant`, `color`, `size` y `radius` son sus valores de base.
	 *
	 * @since 1.10.0
	 */
	readonly copyButton?: UIComponentDefaults<typeof copyButtonTheme, Pick<VariantProps<typeof copyButtonTheme>, UIActionChoices>>
	/**
	 * `UIDateRange`: `class` llega al `<fieldset>`, como la prop de la instancia.
	 *
	 * @since 1.11.0
	 */
	readonly dateRange?: UIComponentDefaults<typeof dateRangeTheme>
	readonly descriptionList?: UIComponentDefaults<typeof descriptionListTheme>
	readonly diff?: UIComponentDefaults<typeof diffTheme>
	readonly disclosure?: UIComponentDefaults<typeof disclosureTheme>
	readonly drawer?: UIComponentDefaults<typeof drawerTheme>
	readonly empty?: UIComponentDefaults<typeof emptyTheme>
	readonly field?: UIComponentDefaults<typeof fieldTheme>
	readonly footer?: UIComponentDefaults<typeof footerTheme>
	readonly header?: UIComponentDefaults<typeof headerTheme>
	/**
	 * `UIHint`: `class` llega al botón, como la prop de la instancia.
	 *
	 * @since 1.10.0
	 */
	readonly hint?: UIComponentDefaults<typeof hintTheme>
	/**
	 * `UIIconButton`: `class` llega al botón o al enlace, y `variant`, `color`, `size` y `radius` son sus valores de base.
	 *
	 * @since 1.10.0
	 */
	readonly iconButton?: UIComponentDefaults<typeof iconButtonTheme, Pick<VariantProps<typeof iconButtonTheme>, UIActionChoices>>
	/** `UIInput`: `class` llega al `<input>`, y `variant`, `color`, `size` y `radius` son sus valores de base. */
	readonly input?: UIComponentDefaults<typeof inputTheme, Pick<VariantProps<typeof inputTheme>, UIActionChoices>>
	readonly link?: UIActionDefaults
	/** `UILinkCard`: `variant`, `color`, `radius` y `elevation` son valores de base de su receta (`linkCardTheme`). */
	readonly linkCard?: UIComponentDefaults<typeof linkCardTheme, Pick<VariantProps<typeof linkCardTheme>, UILinkCardChoices>>
	readonly localeSuggestion?: UIComponentDefaults<typeof localeSuggestionTheme>
	readonly localeSwitcher?: UIComponentDefaults<typeof localeSwitcherTheme>
	/** `UIMarkdownEditor`, del módulo `@meekojs/ui/editor`. */
	readonly markdownEditor?: UIComponentDefaults<typeof markdownEditorTheme>
	/**
	 * `class` llega a la lista del menú, como la prop de la instancia.
	 *
	 * @since 1.10.0
	 */
	readonly menu?: UIComponentDefaults<typeof menuTheme>
	readonly modal?: UIComponentDefaults<typeof modalTheme>
	readonly navigationTabs?: UIComponentDefaults<typeof navigationTabsTheme>
	readonly navigationTree?: UIComponentDefaults<typeof navigationTreeTheme>
	readonly page?: UIComponentDefaults<typeof pageTheme>
	readonly pageHeader?: UIComponentDefaults<typeof pageHeaderTheme>
	readonly pageNavigation?: UIComponentDefaults<typeof pageNavigationTheme>
	readonly pagination?: UIComponentDefaults<typeof paginationTheme>
	/** `class` llega al contenido del popover, como la prop de la instancia. */
	readonly popover?: UIComponentDefaults
	readonly prose?: UIComponentDefaults
	readonly radioGroup?: UIComponentDefaults<typeof radioGroupTheme>
	/**
	 * `size` de base; la prop de la instancia gana sobre él.
	 *
	 * @since 1.10.0
	 */
	readonly segmentedControl?: UIComponentDefaults<typeof segmentedControlTheme, Pick<VariantProps<typeof segmentedControlTheme>, 'size'>>
	readonly select?: UIComponentDefaults<typeof selectTheme>
	readonly skeleton?: UIComponentDefaults<typeof skeletonTheme>
	readonly slider?: UIComponentDefaults<typeof sliderTheme>
	/**
	 * `UISparkline`, también el de `UIStat trend`: `class` llega al `<svg>`, y `ui` a `base`, `area` y `line`.
	 *
	 * @since 1.10.0
	 */
	readonly sparkline?: UIComponentDefaults<typeof sparklineTheme>
	readonly stat?: UIComponentDefaults<typeof statTheme>
	readonly switch?: UIComponentDefaults<typeof switchTheme>
	/** `class` llega a la `<table>`, como la prop de la instancia; el contenedor es `ui.base`. */
	readonly table?: UIComponentDefaults<typeof tableTheme, Pick<VariantProps<typeof tableTheme>, 'density'>>
	readonly tableOfContents?: UIComponentDefaults<typeof tableOfContentsTheme>
	readonly tabs?: UIComponentDefaults<typeof tabsTheme>
	readonly textarea?: UIComponentDefaults<typeof textareaTheme>
	readonly themeToggle?: UIComponentDefaults<typeof themeToggleTheme>
	/** Sólo `ui`: un `UIToast` no recibe `class`. También se aplica a los avisos de `useToast()`. */
	readonly toast?: Omit<UIComponentDefaults<typeof toastTheme>, 'class'>
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
