# meeko/rules-of-composables

Exige llamar a los composables en la raíz del script de un `.meeko` o en el cuerpo principal de otro composable. Está activada con nivel `error` en `defineEslint()` y en el preset recomendado, también para JavaScript y TypeScript.

Reconoce la convención abierta `useX` (`use` seguido de mayúscula, número o `_`), incluidos composables propios, imports con alias y accesos estáticos como `hooks.useCustom()`. No mantiene una lista de APIs. Los nombres ordinarios como `useful` o `createId` quedan fuera.

```ts
// Válido: cuerpo principal de otro composable.
export function useItem() {
	const id = useId()
	return { id }
}

// Inválido: una función que se ejecutará después del setup.
function handleClick() {
	const id = useId()
}

// Válido: un generador independiente del contexto.
function createItem() {
	return { id: createId() }
}
```

También rechaza llamadas dentro de condiciones, bucles, `try/catch`, callbacks, parámetros por defecto o expresiones de plantilla, y llamadas posteriores a un `await` o a un retorno anticipado. En la raíz del `<script>` de un `.meeko`, `await useApi()` y `await useRpcQuery()` no cuentan como suspensión: el render del framework repite el setup con los datos, así que los composables posteriores siguen en el setup síncrono. Los `await` de navegador (`useElementRef`, `useSocket`, `useSocketClient`) sí la cuentan, igual que cualquier `await` dentro de un composable propio. Un guard que lanza una excepción antes del composable es válido: aborta la ejecución completa.

No tiene opciones ni autofix. Se puede ajustar con `rules: { 'meeko/rules-of-composables': 'warn' }`. La comprobación es estática: no demuestra que quien invoque un composable lo haga durante un setup, ni sigue aliases dinámicos, retornados o reasignados. El runtime mantiene sus comprobaciones de contexto.
