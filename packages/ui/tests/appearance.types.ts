import type { VariantProps } from 'tailwind-variants/lite'

import { appearance, type ButtonAppearance, type InputAppearance } from '@meekojs/ui/theme'
import { tv } from 'tailwind-variants/lite'

const recipe = tv({
	...appearance({ variant: ['solid', 'ghost'], disabled: true, color: false }),
	defaultVariants: { variant: 'solid', disabled: false },
})

type Props = VariantProps<typeof recipe>

const valid: Props = { variant: 'ghost', disabled: true }
recipe(valid)

// @ts-expect-error Solo están habilitados solid y ghost.
recipe({ variant: 'outline' })
// @ts-expect-error La receta omitió la propiedad color.
recipe({ color: 'primary' })
// @ts-expect-error Los estados de tv se activan con booleanos.
recipe({ disabled: 'true' })
// @ts-expect-error La selección debe pertenecer a la propiedad.
appearance({ size: ['solid'] })
// @ts-expect-error La propiedad debe estar en el catálogo.
appearance({ unknown: true })
// @ts-expect-error Input solo habilita cuatro colores.
const invalidInput: InputAppearance = { color: 'blue' }
// @ts-expect-error Button solo habilita cinco tratamientos.
const invalidButton: ButtonAppearance = { variant: 'surface' }
void [invalidInput, invalidButton]
