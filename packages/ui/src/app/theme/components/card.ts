// The look of <UICard> and <UILinkCard>. The color comes from the shared catalog (`appearance()`), aimed at the
// `base` slot: each pair of `variant` and `color` is one compound variant with the steps of its scale. A card is
// not a control, so it drops the pointer states of the catalog (`not-disabled:hover:*`, `not-disabled:active:*`),
// which a <section> would match; a link card keeps them, because it is a link. The space between the content and
// the edge is `padding`, which <UICard> also fills from `density`. `defineTheme` merges the classes with Tailwind
// Merge, so the `class` of the consumer wins over the one of the recipe.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { appearance } from '../base/appearance'

/**
 * A component written straight in a <UIProse> keeps the rhythm of its blocks: no space above it and the gap of a
 * paragraph below, except as the last one. The prose's own rules stop at elements marked with meeko-ui-component.
 */
export const inProse = 'meeko-ui-component [.meeko-ui-prose>&]:mt-0 [.meeko-ui-prose>&]:mb-6 [.meeko-ui-prose>&:last-child]:mb-0'

/** Tratamientos que admite una card: los del catálogo salvo `ghost` y `link`, que son de acciones. */
export const cardVariants = ['surface', 'outline', 'soft', 'subtle', 'solid', 'glass', 'plain'] as const

/** Espacio entre el contenido de una card y su borde. */
export const cardPaddings = ['none', 'sm', 'md', 'lg'] as const

const options = { variant: cardVariants, color: true, radius: true, elevation: true } as const

/** The catalog aimed at the root of the card. */
const selection = appearance(options, { slot: 'base' })

/** The classes of a pair without the pointer states: a card does not react to the pointer. */
const still = (classes: string): string =>
	classes
		.split(' ')
		.filter((name) => !name.startsWith('not-disabled:'))
		.join(' ')

/** The pairs of the catalog for a static surface, still aimed at `base`. */
const stillCompounds = selection.compoundVariants.map((entry) => ({ ...entry, class: { base: still(entry.class.base) } }))

/**
 * A neutral card holds content and reads the semantic tokens of the page, not the neutral scale: its text is
 * `--ui-color-text` and its description the soft text, where the catalog gives step 11 to every neutral
 * treatment, and a neutral surface is `--ui-color-surface` with `--ui-color-border`. They have the same values
 * by default, but `ui.tokens` (`surface`, `border`, `text`, `textSoft`, `surfaceHover`) only sets the semantic
 * ones. A solid keeps its contrast text.
 */
const neutralText = { color: 'neutral', variant: ['outline', 'subtle', 'glass'], class: { base: 'text-text', description: 'text-text-soft' } } as const
const neutralSurface = { color: 'neutral', variant: 'surface', class: { base: 'border-border bg-surface text-text', description: 'text-text-soft' } } as const
const neutralSoft = { color: 'neutral', variant: 'soft', class: { base: 'bg-control-hover text-text', description: 'text-text-soft' } } as const
/** A neutral link card marks itself with the strong border and the background of a hovered control. */
const neutralSurfaceLink = { color: 'neutral', variant: 'surface', class: { base: 'border-border bg-surface text-text not-disabled:hover:border-border-strong not-disabled:hover:bg-control-hover not-disabled:active:bg-control-hover', description: 'text-text-soft' } } as const
const neutralSoftLink = { color: 'neutral', variant: 'soft', class: { base: 'text-text', description: 'text-text-soft' } } as const

/** An app rule such as `.page p { color }` would leave the text of a solid unreadable. */
const solidText = { variant: 'solid', class: { base: '[&_:where(p,li):not([class])]:text-inherit' } } as const

/** The border is always there, transparent where the treatment has none, so every card has the same size. */
const frame = 'border-(length:--ui-border-width) border-transparent'

/**
 * Receta de `UICard`: `variant`, `color`, `radius`, `elevation`, `padding` y `actionsWrap`, con los slots `base`,
 * `header`, `title`, `description`, `actions`, `body` y `footer`. Sin ellas es una superficie `surface` `neutral`
 * de radio `lg` y padding `md`. Su padding vive en `--card-padding`, que también lee una `<UITable>` del cuerpo:
 * una tabla se alinea con el resto del cuerpo, y una tabla sola llega a los bordes de la card, que es su marco,
 * mientras sus celdas primera y última conservan el padding de la card.
 *
 * @example
 * ```ts
 * import { cardTheme } from '@meekojs/ui/theme'
 *
 * const { base, body } = cardTheme({ variant: 'soft', color: 'primary', radius: 'xl' })
 * const classes = base({ class: 'my-panel' })
 * ```
 */
export const cardTheme = defineTheme({
	slots: {
		base: ['group/card box-border flex min-w-0 flex-col', frame, 'font-sans leading-normal', inProse],
		header: [
			'grid gap-y-1.5 px-(--card-padding) pt-(--card-padding) pb-0 [overflow-wrap:anywhere]',
			'group-has-[>div>:only-child>table[role=table]]/card:pb-3',
			// The title, or the headings of the `header` snippet.
			'[&_:is(h1,h2,h3,h4)]:m-0 [&_:is(h1,h2,h3,h4)]:text-xl [&_:is(h1,h2,h3,h4)]:leading-snug [&_:is(h1,h2,h3,h4)]:font-semibold [&_:is(h1,h2,h3,h4)]:tracking-tight [&_:is(h1,h2,h3,h4)]:text-inherit',
		],
		title: '',
		description: 'm-0 text-md',
		actions: 'flex min-h-lh flex-wrap items-center [align-self:start] gap-2',
		body: [
			'flex-1 p-(--card-padding) [overflow-wrap:anywhere] [&>:first-child]:mt-0 [&>:last-child]:mb-0',
			'[&_table[role=table]>*>tr>:first-child]:ps-0 [&_table[role=table]>*>tr>:last-child]:pe-0',
			'has-[>:only-child>table[role=table]]:p-0 [&>:only-child:has(>table[role=table])]:rounded-[inherit] [&>:only-child>table[role=table]]:bg-transparent',
			'[&>:only-child>table[role=table]>*>tr>:first-child]:ps-(--card-padding) [&>:only-child>table[role=table]>*>tr>:last-child]:pe-(--card-padding)',
		],
		footer: 'px-(--card-padding) pt-0 pb-(--card-padding) [overflow-wrap:anywhere] [&>:first-child]:mt-0 [&>:last-child]:mb-0',
	},
	variants: {
		...selection.variants,
		padding: {
			none: { base: '[--card-padding:var(--ui-space-0)]' },
			sm: { base: '[--card-padding:var(--ui-space-3)]' },
			md: { base: '[--card-padding:var(--ui-space-5)]' },
			lg: { base: '[--card-padding:var(--ui-space-6)]' },
		},
		/** With actions the text stays in the first column; `actionsWrap` places the actions. */
		actions: {
			true: { header: '[&>:not(:last-child)]:col-[1]' },
			false: { header: 'gap-x-1.5' },
		},
		/** Where the actions go: it only applies with actions, in the compound variants below. */
		actionsWrap: {
			inline: {},
			below: {},
			auto: {},
		},
	},
	compoundVariants: [
		...stillCompounds,
		neutralSurface,
		neutralSoft,
		neutralText,
		solidText,
		// Two columns: the text, and the actions beside the title and description.
		{ actions: true, actionsWrap: 'inline', class: { header: 'grid-cols-[minmax(0,1fr)_auto] gap-x-4', actions: 'col-[2] row-[1/span_2] justify-end' } },
		// One column: the actions follow the text, in the order of the DOM.
		{ actions: true, actionsWrap: 'below', class: { actions: 'pt-1.5' } },
		// The header is the container: below the width of --container-card-narrow the actions leave the second
		// column for a row of their own, and the empty column takes no space because the gap is their margin.
		{
			actions: true,
			actionsWrap: 'auto',
			class: {
				header: '@container grid-cols-[minmax(0,1fr)_auto]',
				actions: ['col-[2] row-[1/span_2] ms-4 justify-end', '@max-card-narrow:col-[1] @max-card-narrow:row-auto @max-card-narrow:ms-0 @max-card-narrow:justify-start @max-card-narrow:pt-1.5'],
			},
		},
	],
	defaultVariants: { variant: 'surface', color: 'neutral', radius: 'lg', padding: 'md', actions: false, actionsWrap: 'inline' },
})

/** Variantes de la receta de `UICard`, derivadas de `cardTheme`. */
export type CardThemeProps = ThemeVariants<typeof cardTheme>

/** Tratamiento visual de una card: `surface`, `outline`, `soft`, `subtle`, `solid`, `glass` o `plain`. */
export type UICardVariant = NonNullable<CardThemeProps['variant']>
/** Color semántico de una card: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` o `danger`. */
export type UICardColor = NonNullable<CardThemeProps['color']>
/** Radio del contorno de una card, de `none` a `full`. */
export type UICardRadius = NonNullable<CardThemeProps['radius']>
/** Sombra de una card, de `none` a `2xl`. */
export type UICardElevation = NonNullable<CardThemeProps['elevation']>
/** Espacio entre el contenido de una card y su borde: `none`, `sm`, `md` o `lg`. */
export type UICardPadding = NonNullable<CardThemeProps['padding']>

/**
 * Receta de `UILinkCard`, una superficie enlazada que se marca bajo el puntero: `variant`, `color`, `radius` y
 * `elevation`, con los slots `base`, `title` y `description`. Sin ellas es `surface`, `neutral` y radio `lg`,
 * como `UICard`. Su padding es `--ui-link-card-padding`.
 *
 * @example
 * ```ts
 * import { linkCardTheme } from '@meekojs/ui/theme'
 *
 * const { base, title } = linkCardTheme({ variant: 'outline', color: 'primary' })
 * ```
 */
export const linkCardTheme = defineTheme({
	slots: {
		base: [
			'box-border flex h-full min-w-0 flex-col gap-1.5 p-[var(--ui-link-card-padding,var(--ui-space-4))]',
			frame,
			'font-sans no-underline decoration-current [overflow-wrap:anywhere]',
			'transition-[border-color,background-color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
			'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-solid focus-visible:outline-focus focus-visible:outline-offset-(--ui-focus-ring-offset)',
		],
		title: 'text-lg leading-snug font-medium tracking-tight',
		description: 'text-sm leading-normal',
	},
	variants: selection.variants,
	// With the pointer states of the catalog: a link card is a link.
	compoundVariants: [...selection.compoundVariants, neutralSurfaceLink, neutralSoftLink, neutralText],
	defaultVariants: { variant: 'surface', color: 'neutral', radius: 'lg' },
})

/** Variantes de la receta de `UILinkCard`, derivadas de `linkCardTheme`. */
export type LinkCardThemeProps = ThemeVariants<typeof linkCardTheme>
