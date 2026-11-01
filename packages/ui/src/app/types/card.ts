import type { UICardVariant } from './config'
import type { UIDensity } from './forms'

/** Superficie de contenido con cabecera, cuerpo y pie. @example `<UICard title="Resumen" density="compact" padding="sm">Contenido</UICard>` */
export interface UICardProps {
	/** Título de la sección. */
	title?: string
	/** Descripción de la sección. */
	description?: string
	/** Tratamiento visual. */
	variant?: UICardVariant
	/** Espacio predeterminado entre el contenido y el borde. */
	density?: UIDensity
	/** Padding explícito; gana sobre density. */
	padding?: 'none' | 'sm' | 'md' | 'lg'
	/** Clases adicionales. */
	class?: string
}
