/** Anchos máximos del contenedor, en rem, desde contenido compacto hasta 4K. */
export type UIContainerSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4k' | 'full'

/** Espacio lateral fluido; none permite anidar contenedores sin duplicarlo. */
export type UIContainerGutter = 'none' | 'sm' | 'md' | 'lg'

/** Etiquetas estructurales que conserva el componente en SSR e hidratación. */
export type UIContainerTag = 'div' | 'section' | 'main' | 'article' | 'header' | 'footer' | 'nav' | 'aside'
