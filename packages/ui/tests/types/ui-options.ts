import type { UIOptions } from '@meekojs/ui'

import type { ComponentProps as LinkProps } from '../../dist/app/components/Link.d.meeko.ts'

const options = { tokens: { primary: 'var(--pill)', accent: 'var(--accent)' }, defaults: { link: { shape: 'pill', variant: 'outline' } } } satisfies UIOptions
const link: LinkProps = { href: '/docs', variant: 'ghost', size: 'sm' }
void [options, link]
// @ts-expect-error Unknown semantic token.
const invalidToken: UIOptions = { tokens: { colour: 'red' } }
// @ts-expect-error Component defaults must use supported variants.
const invalidDefault: UIOptions = { defaults: { button: { variant: 'tertiary' } } }
// @ts-expect-error Navigation requires an href.
const missingHref: LinkProps = { variant: 'primary' }
void [invalidToken, invalidDefault, missingHref]
