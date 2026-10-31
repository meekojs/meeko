/** Contrato privado del alias que el módulo enlaza con el registro del consumidor. */
declare module 'virtual:meeko-ui-components' {
	import type { ComponentArgs, ComponentName, ResolvedComponent } from '@meekojs/meeko'

	export function resolveComponent<Name extends ComponentName>(...request: [name: Name, props: unknown] & ComponentArgs): Promise<ResolvedComponent<Name>>
}
