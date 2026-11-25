import { appearance, type ButtonThemeProps, defineTheme, type IconButtonThemeProps, type InputAppearance, type ThemeVariants } from '@meekojs/ui/theme'
import { hues } from '@meekojs/ui/theme/hues'

const recipe = defineTheme({
	...appearance({ variant: ['solid', 'ghost'], color: ['primary', 'danger'], disabled: true, size: false }),
	defaultVariants: { variant: 'solid', color: 'primary', disabled: false },
})

type Props = ThemeVariants<typeof recipe>

const valid: Props = { variant: 'ghost', color: 'danger', disabled: true }
recipe(valid)
recipe({ color: 'primary', class: 'bg-red-9' })

// @ts-expect-error Solo están habilitados solid y ghost.
recipe({ variant: 'outline' })
// @ts-expect-error Solo están habilitados primary y danger.
recipe({ color: 'info' })
// @ts-expect-error La receta omitió la propiedad size.
recipe({ size: 'md' })
// @ts-expect-error Los estados de tv se activan con booleanos.
recipe({ disabled: 'true' })
// @ts-expect-error La selección debe pertenecer a la propiedad.
appearance({ size: ['solid'] })
// @ts-expect-error La propiedad debe estar en el catálogo.
appearance({ unknown: true })
// @ts-expect-error Se retiraron error, accent, gradient, 2xs y 2xl.
appearance({ color: ['error', 'accent'], variant: ['gradient'], size: ['2xs', '2xl'] })
// @ts-expect-error Los tonos crudos solo existen si se pasa la paleta.
appearance({ color: ['crimson'] })

// Las compuestas conservan el tipado literal de la selección.
const selection = appearance({ variant: ['soft', 'plain'], color: ['info'] })
const compound: { color: 'info'; variant: 'soft' } = selection.compoundVariants[0]!
void compound
// Sin color no hay compuestas.
const empty: [] = appearance({ variant: true }).compoundVariants
void empty

// Con la paleta, color admite los nombres de Radix además de los semánticos.
const tag = defineTheme({ ...appearance({ variant: ['soft'], color: ['primary', 'crimson', 'gray'] }, { hues }) })
tag({ color: 'crimson' })
// @ts-expect-error rose es un nombre de Tailwind, no de Radix.
tag({ color: 'rose' })
// @ts-expect-error La paleta no habilita tonos que no se eligieron.
tag({ color: 'teal' })

// Las clases pueden ir a un slot concreto de una receta con slots.
const select = defineTheme({
	slots: { base: 'relative', trigger: 'flex' },
	...appearance({ variant: ['outline'], color: true, size: ['sm', 'md'] }, { slot: 'trigger' }),
})
select({ variant: 'outline', color: 'neutral', size: 'sm' }).trigger()
const sizeClass: { trigger: 'min-h-(--ui-control-height-sm) p-(--ui-control-padding-sm) text-control-sm' } = appearance({ size: ['sm'] }, { slot: 'trigger' }).variants.size.sm
void sizeClass
// @ts-expect-error El slot debe existir en la receta.
defineTheme({ slots: { base: 'relative' }, ...appearance({ size: ['sm'] }, { slot: 'missing' }) })

// @ts-expect-error Input solo habilita cuatro colores.
const invalidInput: InputAppearance = { color: 'info' }
// @ts-expect-error Button no habilita glass ni plain.
const invalidButton: ButtonThemeProps = { variant: 'glass' }
// @ts-expect-error Button usa solo colores semánticos.
const rawButton: ButtonThemeProps = { color: 'crimson' }
// @ts-expect-error IconButton no tiene link: un icono no tiene texto que subrayar.
const linkIcon: IconButtonThemeProps = { variant: 'link' }
const button: ButtonThemeProps = { variant: 'surface', color: 'neutral', size: 'xl', radius: 'full', width: 'full', elevation: 'sm', iconOnly: true }
void [invalidInput, invalidButton, rawButton, linkIcon, button]
