import * as generated from 'virtual:meeko-icon'

import type { IconData } from '../index'

// Explicit types keep the published declaration free of the virtual module, which only Vite resolves.

/** Icons of `icon.include`, for dynamic names. */
export const icons: Readonly<Record<string, IconData>> = generated.icons

/** Default height of the icons, `icon.size`. */
export const size: string = generated.size

/** Whether this is `meeko dev`, to warn about a missing icon. */
export const dev: boolean = generated.dev
