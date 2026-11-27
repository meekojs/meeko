import type { UIDefaults, UIOptions } from '@meekojs/ui'
import type { UIMarkdownEditorProps } from '@meekojs/ui/editor'
import type {
	UIAlertProps,
	UIAvatarProps,
	UIBadgeProps,
	UIBreadcrumbProps,
	UIButtonProps,
	UICardProps,
	UICheckboxProps,
	UICodeBlockProps,
	UIComboboxProps,
	UICommandPaletteProps,
	UIDateRangeProps,
	UIDescriptionListProps,
	UIDiffProps,
	UIDisclosureProps,
	UIDrawerProps,
	UIEmptyProps,
	UIFieldProps,
	UIFooterProps,
	UIHeaderProps,
	UIHintProps,
	UIIconButtonProps,
	UIInputProps,
	UILinkCardProps,
	UILocaleSuggestionProps,
	UILocaleSwitcherProps,
	UIMenuProps,
	UIModalProps,
	UINavigationTabsProps,
	UINavigationTreeProps,
	UIPageHeaderProps,
	UIPageNavigationProps,
	UIPageProps,
	UIPaginationProps,
	UIRadioGroupProps,
	UISegmentedControlProps,
	UISelectProps,
	UISkeletonProps,
	UISliderProps,
	UISparklineProps,
	UIStatProps,
	UISwitchProps,
	UITableOfContentsProps,
	UITableProps,
	UITabsProps,
	UIThemeToggleProps,
	UIToastProps,
} from '@meekojs/ui/runtime'

import type { ComponentProps as LinkProps } from '../../dist/app/components/Link.d.meeko.ts'

const options = { tokens: { primary: 'var(--pill)', accentSoft: 'var(--soft)' }, defaults: { link: { radius: 'full', variant: 'outline', color: 'neutral' } } } satisfies UIOptions
const link: LinkProps = { href: '/docs', variant: 'ghost', color: 'neutral', size: 'sm' }
void [options, link]
// @ts-expect-error Unknown semantic token.
const invalidToken: UIOptions = { tokens: { colour: 'red' } }
// @ts-expect-error The options of the --meeko-ui-* aliases are gone.
const removedAlias: UIOptions = { tokens: { accent: 'red' } }
// @ts-expect-error Component defaults must use supported variants.
const invalidDefault: UIOptions = { defaults: { button: { variant: 'tertiary' } } }
// @ts-expect-error The old variants of a button are gone.
const oldVariant: UIOptions = { defaults: { button: { variant: 'primary' } } }
// @ts-expect-error shape is now radius.
const oldShape: UIOptions = { defaults: { button: { shape: 'pill' } } }
// @ts-expect-error Navigation requires an href.
const missingHref: LinkProps = { variant: 'solid' }
void [invalidToken, removedAlias, invalidDefault, oldVariant, oldShape, missingHref]

// UICard and UILinkCard: the look of the theme recipe, with variant, color, radius and elevation.
const cardLook = { defaults: { card: { variant: 'soft', color: 'primary', radius: 'xl', elevation: 'md', padding: 'sm' }, linkCard: { variant: 'outline', color: 'neutral', radius: 'md', elevation: 'sm' } } } satisfies UIOptions
const glassCard: UICardProps = { variant: 'glass', color: 'info', radius: 'none', elevation: '2xl' }
const plainLinkCard: UILinkCardProps = { title: 'Docs', href: '/docs', variant: 'plain', color: 'success' }
void [cardLook, glassCard, plainLinkCard]
// @ts-expect-error `elevated` is now `elevation`.
const elevatedCard: UIOptions = { defaults: { card: { variant: 'elevated' } } }
// @ts-expect-error A card has no `ghost`: it is a treatment of actions.
const ghostCard: UICardProps = { variant: 'ghost' }
// @ts-expect-error The `appearance` prop is gone: its keys are props.
const appearanceCard: UICardProps = { appearance: { variant: 'surface' } }
// @ts-expect-error A link card has no padding variant.
const paddedLinkCard: UIOptions = { defaults: { linkCard: { padding: 'sm' } } }
void [elevatedCard, ghostCard, appearanceCard, paddedLinkCard]

// UIInput: the look of the theme recipe, with variant, color, size and radius.
const inputLook = { defaults: { input: { variant: 'soft', color: 'primary', size: 'lg', radius: 'full', class: 'app-field' } } } satisfies UIOptions
const ghostInput: UIInputProps = { variant: 'ghost', color: 'danger', size: 'xs', radius: 'none' }
void [inputLook, ghostInput]
// @ts-expect-error The `appearance` prop of UIInput is gone: its keys are props.
const appearanceInput: UIInputProps = { appearance: { variant: 'soft' } }
// @ts-expect-error A field has no `solid`: it is a treatment of actions.
const solidInput: UIInputProps = { variant: 'solid' }
// @ts-expect-error Nor does ui.defaults.input take it.
const solidInputDefault: UIOptions = { defaults: { input: { variant: 'solid' } } }
void [appearanceInput, solidInput, solidInputDefault]

// Where a component sits is its `layout`: `variant` is only a treatment of the catalog.
const panelEmpty: UIEmptyProps = { layout: 'panel' }
const segmentedRadios: UIRadioGroupProps = { legend: 'Periodo', options: [], layout: 'segmented' }
const segmentedTabs: UINavigationTabsProps = { items: [], layout: 'segmented' }
const collapsibleToc: UITableOfContentsProps = { entries: [], layout: 'collapsible' }
void [panelEmpty, segmentedRadios, segmentedTabs, collapsibleToc]
// @ts-expect-error `variant="panel"` is now `layout="panel"`.
const variantEmpty: UIEmptyProps = { variant: 'panel' }
// @ts-expect-error `variant="segmented"` is now `layout="segmented"`.
const variantRadios: UIRadioGroupProps = { legend: 'Periodo', options: [], variant: 'segmented' }
// @ts-expect-error `variant="segmented"` is now `layout="segmented"`.
const variantTabs: UINavigationTabsProps = { items: [], variant: 'segmented' }
// @ts-expect-error `variant="collapsible"` is now `layout="collapsible"`.
const variantToc: UITableOfContentsProps = { entries: [], variant: 'collapsible' }
void [variantEmpty, variantRadios, variantTabs, variantToc]

// ui.defaults: class and ui for each component, with the slots of its own `ui` prop.
const panel = {
	defaults: {
		card: { padding: 'sm', density: 'compact', actionsWrap: 'auto', ui: { header: 'panel-card-header' } },
		table: { density: 'compact', class: 'panel-table', ui: { cell: 'panel-cell' } },
		stat: { ui: { value: 'panel-stat-value' } },
		alert: { class: 'panel-alert' },
		descriptionList: { ui: { label: 'panel-label' } },
		toast: { ui: { message: 'panel-toast' } },
		tooltip: { class: 'panel-tooltip' },
		button: { variant: 'ghost', class: 'panel-button' },
	},
} satisfies UIOptions
void panel
// @ts-expect-error A slot that the card does not have.
const unknownSlot: UIOptions = { defaults: { card: { ui: { head: 'x' } } } }
// @ts-expect-error The actions of a card go inline, below or auto.
const wrapDefault: UIOptions = { defaults: { card: { actionsWrap: 'wrap' } } }
// @ts-expect-error The tone of an alert says what it is: it has no default.
const toneDefault: UIOptions = { defaults: { alert: { tone: 'danger' } } }
// @ts-expect-error The layout of a table is not a default.
const layoutDefault: UIOptions = { defaults: { table: { layout: 'grid' } } }
// @ts-expect-error A button has no slots.
const buttonSlots: UIOptions = { defaults: { button: { ui: { base: 'x' } } } }
// @ts-expect-error A toast takes no class.
const toastClass: UIOptions = { defaults: { toast: { class: 'x' } } }
// @ts-expect-error The keys are the names without the prefix.
const prefixed: UIOptions = { defaults: { UICard: { class: 'x' } } }
// @ts-expect-error Classes are a string.
const classList: UIOptions = { defaults: { stat: { class: ['a'] } } }
void [unknownSlot, wrapDefault, toneDefault, layoutDefault, buttonSlots, toastClass, prefixed, classList]

// The badge, the avatar and the messages take `variant` and `color`; `tone`, `appearance` and `shape` are gone.
const badgeDefaults: UIOptions = { defaults: { badge: { variant: 'solid', color: 'success', radius: 'sm' }, avatar: { size: 'lg', variant: 'surface', color: 'neutral', radius: 'md' } } }
const coloredBadge: UIBadgeProps = { variant: 'outline', color: 'danger', radius: 'full', dot: true }
const coloredAlert: UIAlertProps = { variant: 'solid', color: 'warning', title: 'x' }
const coloredToast: UIToastProps = { text: 'x', variant: 'outline', color: 'info' }
const coloredLine: UISparklineProps = { values: [1, 2], color: 'primary' }
const coloredAvatar: UIAvatarProps = { name: 'Ana', variant: 'solid', color: 'secondary', radius: 'md', size: 'sm' }
// @ts-expect-error tone is gone from UIBadge: color="primary".
const badgeTone: UIBadgeProps = { tone: 'accent' }
// @ts-expect-error appearance is gone from UIBadge: its keys are props.
const badgeAppearance: UIBadgeProps = { appearance: { variant: 'solid' } }
// @ts-expect-error tone is gone from UIAlert: color="danger".
const alertTone: UIAlertProps = { tone: 'danger' }
// @ts-expect-error accent is primary.
const lineAccent: UISparklineProps = { values: [1], color: 'accent' }
// @ts-expect-error shape is now radius.
const avatarShape: UIOptions = { defaults: { avatar: { shape: 'rounded' } } }
void [badgeDefaults, coloredBadge, coloredAlert, coloredToast, coloredLine, coloredAvatar, badgeTone, badgeAppearance, alertTone, lineAccent, avatarShape]

/** The `ui` of each component in ui.defaults is exactly the `ui` prop of the component. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Slots<K extends keyof UIDefaults> = NonNullable<UIDefaults[K]>['ui' & keyof NonNullable<UIDefaults[K]>]
type SameSlots = [
	Equal<Slots<'alert'>, UIAlertProps['ui']>,
	Equal<Slots<'avatar'>, UIAvatarProps['ui']>,
	Equal<Slots<'badge'>, UIBadgeProps['ui']>,
	Equal<Slots<'breadcrumb'>, UIBreadcrumbProps['ui']>,
	Equal<Slots<'card'>, UICardProps['ui']>,
	Equal<Slots<'checkbox'>, UICheckboxProps['ui']>,
	Equal<Slots<'codeBlock'>, UICodeBlockProps['ui']>,
	Equal<Slots<'combobox'>, UIComboboxProps<string>['ui']>,
	Equal<Slots<'commandPalette'>, UICommandPaletteProps<string>['ui']>,
	Equal<Slots<'dateRange'>, UIDateRangeProps['ui']>,
	Equal<Slots<'descriptionList'>, UIDescriptionListProps['ui']>,
	Equal<Slots<'diff'>, UIDiffProps['ui']>,
	Equal<Slots<'disclosure'>, UIDisclosureProps['ui']>,
	Equal<Slots<'drawer'>, UIDrawerProps['ui']>,
	Equal<Slots<'empty'>, UIEmptyProps['ui']>,
	Equal<Slots<'field'>, UIFieldProps['ui']>,
	Equal<Slots<'footer'>, UIFooterProps['ui']>,
	Equal<Slots<'header'>, UIHeaderProps['ui']>,
	Equal<Slots<'hint'>, UIHintProps['ui']>,
	Equal<Slots<'iconButton'>, UIIconButtonProps['ui']>,
	Equal<Slots<'linkCard'>, UILinkCardProps['ui']>,
	Equal<Slots<'localeSuggestion'>, UILocaleSuggestionProps['ui']>,
	Equal<Slots<'localeSwitcher'>, UILocaleSwitcherProps['ui']>,
	Equal<Slots<'markdownEditor'>, UIMarkdownEditorProps['ui']>,
	Equal<Slots<'menu'>, UIMenuProps['ui']>,
	Equal<Slots<'modal'>, UIModalProps['ui']>,
	Equal<Slots<'navigationTabs'>, UINavigationTabsProps['ui']>,
	Equal<Slots<'navigationTree'>, UINavigationTreeProps['ui']>,
	Equal<Slots<'page'>, UIPageProps['ui']>,
	Equal<Slots<'pageHeader'>, UIPageHeaderProps['ui']>,
	Equal<Slots<'pageNavigation'>, UIPageNavigationProps['ui']>,
	Equal<Slots<'pagination'>, UIPaginationProps['ui']>,
	Equal<Slots<'radioGroup'>, UIRadioGroupProps['ui']>,
	Equal<Slots<'segmentedControl'>, UISegmentedControlProps['ui']>,
	Equal<Slots<'select'>, UISelectProps<string>['ui']>,
	Equal<Slots<'skeleton'>, UISkeletonProps['ui']>,
	Equal<Slots<'slider'>, UISliderProps['ui']>,
	Equal<Slots<'sparkline'>, UISparklineProps['ui']>,
	Equal<Slots<'stat'>, UIStatProps['ui']>,
	Equal<Slots<'switch'>, UISwitchProps['ui']>,
	Equal<Slots<'table'>, UITableProps<{ id: number }>['ui']>,
	Equal<Slots<'tableOfContents'>, UITableOfContentsProps['ui']>,
	Equal<Slots<'tabs'>, UITabsProps['ui']>,
	Equal<Slots<'themeToggle'>, UIThemeToggleProps['ui']>,
	Equal<Slots<'toast'>, UIToastProps['ui']>,
]
const sameSlots: false extends SameSlots[number] ? never : true = true
// The variant defaults take the values of their props.
type SameVariants = [
	Equal<NonNullable<UIDefaults['card']>['padding'], UICardProps['padding']>,
	Equal<NonNullable<UIDefaults['card']>['density'], UICardProps['density']>,
	Equal<NonNullable<UIDefaults['card']>['actionsWrap'], UICardProps['actionsWrap']>,
	Equal<NonNullable<UIDefaults['card']>['variant'], UICardProps['variant']>,
	Equal<NonNullable<UIDefaults['card']>['color'], UICardProps['color']>,
	Equal<NonNullable<UIDefaults['card']>['radius'], UICardProps['radius']>,
	Equal<NonNullable<UIDefaults['card']>['elevation'], UICardProps['elevation']>,
	Equal<NonNullable<UIDefaults['linkCard']>['variant'], UILinkCardProps['variant']>,
	Equal<NonNullable<UIDefaults['linkCard']>['color'], UILinkCardProps['color']>,
	Equal<NonNullable<UIDefaults['table']>['density'], UITableProps<{ id: number }>['density']>,
	Equal<NonNullable<UIDefaults['button']>['variant'], UIButtonProps['variant']>,
	Equal<NonNullable<UIDefaults['button']>['color'], UIButtonProps['color']>,
	Equal<NonNullable<UIDefaults['link']>['radius'], UIButtonProps['radius']>,
	Equal<NonNullable<UIDefaults['iconButton']>['variant'], UIIconButtonProps['variant']>,
	Equal<NonNullable<UIDefaults['iconButton']>['size'], UIIconButtonProps['size']>,
	Equal<NonNullable<UIDefaults['segmentedControl']>['size'], UISegmentedControlProps['size']>,
]
const sameVariants: false extends SameVariants[number] ? never : true = true
void [sameSlots, sameVariants]
