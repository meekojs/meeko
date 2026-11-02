# Actualizar de 1.7 a 1.8

`1.8` es un minor. `<MeekoPopover>`, `<MeekoSelect>` y `<MeekoThemeToggle>` quedan obsoletos: siguen funcionando en `1.x` y se retiran en `2.0`. UI `0.2.0` ofrece sus reemplazos con el mismo contrato. La nueva API pública estable `useThemeToggle()` permite construir un selector propio. Los módulos se registran por su nombre (`modules: ['@meekojs/i18n']`) con sus opciones en su clave; importarlos y `[módulo, opciones]` quedan obsoletos (`MEEK126`). Como cambio de seguridad, toda mutación de API y RPC comprueba `Origin` por defecto, también sin sesión (véase [Origin en todas las mutaciones](#origin-en-todas-las-mutaciones)). Esta guía describe los cambios previstos, todavía sin publicar; consulta también el [CHANGELOG](../packages/meeko/CHANGELOG.md) y la [política de estabilidad](stability.md).

## Orden recomendado

1. Actualiza core a `1.8` y `@meekojs/ui` a `0.2.0` cuando están publicados. UI 0.2 requiere Meeko `>=1.8 <2`; no uses el nuevo `UIThemeToggle` con core 1.7.
2. Activa el módulo UI en `meeko.config.ts`.
3. Renombra las tres etiquetas y actualiza los imports explícitos de sus tipos.
4. Ejecuta `meeko check` y comprueba los controles, sus estilos y los formularios en tu aplicación.
5. Revisa los webhooks, las APIs públicas y los clientes sin navegador que llaman a mutaciones sin sesión, y decide para cada uno entre enviar `Origin` o declarar `origin: "none"`.
6. Registra los módulos por su nombre, con sus opciones en su clave (véase [Módulos por su nombre](#módulos-por-su-nombre)).

## Módulo UI requerido

```sh
pnpm add @meekojs/meeko@^1.8.0 @meekojs/ui@^0.2.0
```

```ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	theme: true,
})
```

Conserva el resto de tu configuración. `theme` sólo es necesario para el selector de tema. El módulo registra los componentes y añade su hoja de estilos antes de los estilos de la aplicación: revisa cualquier personalización visual existente.

## Renombrar etiquetas

| Hasta 1.7            | Desde core 1.8 con UI 0.2 |
| -------------------- | ------------------------- |
| `<MeekoPopover>`     | `<UIPopover>`             |
| `<MeekoSelect>`      | `<UICombobox>`            |
| `<MeekoThemeToggle>` | `<UIThemeToggle>`         |

```html
<UIPopover role="menu">
	<snippet name="trigger">Acciones</snippet>
	<button role="menuitem">Editar</button>
</UIPopover>
<UICombobox
	model="color"
	bind:options="colors"
	name="color"
/>
<UIThemeToggle mode="select" />
```

`UICombobox` es la misma lista propia que `<MeekoSelect>`. Un select sin `multiple`, `searchable`, `filter` ni `max` puede pasar además a `UISelect`, un `<select>` nativo con mucho menos JavaScript y con menos marcado propio: véase [su documentación](../packages/ui/README.md#uiselect).

Renombra también las etiquetas de cierre. Props, modelos, snippets, eventos, teclado, accesibilidad y marcado `data-meeko-*` conservan su contrato: los selectores CSS existentes siguen encontrando los mismos atributos. `UICombobox<T, Multiple>` infiere sus tipos de `options` y `multiple` como antes.

## Imports de tipos

Los tres tipos de props cambian de paquete y de prefijo:

```ts
// Antes
import type { MeekoPopoverProps, MeekoSelectProps, MeekoThemeToggleProps, PopoverPlacement, SelectModel } from '@meekojs/meeko/framework'

// Después
import type { UIPopoverProps, UIComboboxProps, UIThemeToggleProps, PopoverPlacement, ComboboxModel } from '@meekojs/ui/runtime'
```

Los auxiliares de popover/select (`PopoverMode`, `PopoverRole`, `PopoverTrigger`, `PopoverToggleEvent`, `PopoverSnippets`, `PopoverExposed`, `SelectOptionState`, `ComboboxFilter`, `ComboboxFilterContext`, `SelectSnippets` y `SelectField`) conservan su nombre y se importan desde `@meekojs/ui/runtime`. Los tipos del sistema de temas (`ThemeChoice`, `ThemeToggleMessages` y `ThemeToggleSnippets`, además de los nuevos `ThemeToggleState` y `ThemeToggleSystem`) permanecen en `@meekojs/meeko/framework`. Los exports antiguos del core siguen disponibles durante 1.x.

## Aviso MEEK121

El compilador emite `MEEK121` al usar las tres etiquetas integradas obsoletas; `meeko check`, el build y el servidor de lenguaje muestran el aviso. El editor tacha la etiqueta y explica su reemplazo en el hover. El aviso no cambia el SSR ni la hidratación en 1.x. Un componente propio que sustituye una etiqueta integrada conserva su resolución normal.

## Selector propio con useThemeToggle()

Si prefieres un selector propio, no necesitas UI. `useThemeToggle()` y los tipos `ThemeToggleState` y `ThemeToggleSystem` son API pública estable de core desde 1.8. El composable devuelve `theme`, `choices`, `system`, `known` e `interactive`. Conserva un formulario `POST /_meeko/theme` con `theme` y `return` para cambiar sin JavaScript, y pinta los iconos con `data-meeko-theme-icon` para que la regla de `<head>` muestre el correcto desde el primer frame. El [ejemplo completo](framework.md#selector-de-tema-propio) explica la hidratación y los nombres accesibles cuando la elección aún no se conoce.

La configuración `theme`, `useTheme()`, la cookie, el script de `<head>`, la regla de iconos y `POST /_meeko/theme` siguen en core. La deprecación afecta a las etiquetas de los controles.

## Origin en todas las mutaciones

Desde `1.8`, los `POST`, `PUT`, `PATCH` y `DELETE` de `defineApiRoute` y todas las llamadas de `defineRpc` responden `403 INVALID_ORIGIN` si su `Origin` falta, es `null` o no es el de la aplicación ni uno de `SessionManager({ allowedOrigins })`, **también sin cookie de sesión**. Hasta `1.7`, una mutación anónima sólo se comprobaba con `origin: "required"`, y otra web podía ejecutar cualquier ruta anónima que aceptara un formulario o JSON enviado como `text/plain`. Es un cambio incompatible aprobado como corrección de seguridad ([política de estabilidad](stability.md#excepciones-aprobadas)).

**Lo que no cambia.** Los navegadores envían `Origin` en toda mutación, también en las de su propio origen, y los clientes `api.*` y `rpc.*` envían el de la petición en curso durante el SSR, así que una aplicación web no necesita cambios. Las mutaciones con sesión ya exigían `Origin` y el token CSRF, y los formularios nativos, `Origin`; siguen igual. `GET`, `HEAD` y `OPTIONS` siguen sin comprobarse.

**Qué revisar:**

- **Webhooks** (pagos, Git, mensajería). Llegan de otro servidor sin `Origin` y ahora reciben `403`. Declare `origin: "none"` en la ruta y verifique la firma o el secreto del proveedor antes de actuar. Vale también para los que envían `application/x-www-form-urlencoded` (Twilio, Slack): desde `1.8`, `"none"` exime de `Origin` a un formulario nativo (`form`) sin sesión, que hasta `1.7` lo exigía siempre. Con `contentType: "response"` y sin `body`, el handler puede leer el cuerpo con `context.request.formData()`:

  ```ts
  // server/api/webhooks/payments.post.ts
  export default defineApiRoute({
  	origin: 'none',
  	contentType: 'response',
  	handler: async ({ context }) => {
  		const payload = await context.request.text()
  		if (!(await verifySignature(payload, context.request.headers.get('x-signature')))) throw new ApiError('INVALID_SIGNATURE', 401)
  		return new Response(null, { status: 204 })
  	},
  })
  ```

- **APIs públicas** para scripts, apps nativas u otros servicios, autenticadas con un token en `authorization` en lugar de la cookie. Declare `origin: "none"` en esas rutas, o haga que el cliente envíe un `Origin` permitido. Si las llaman otras webs desde el navegador, añada además los orígenes a `allowedOrigins` (para que pasen sin `"none"`) o configure CORS en su middleware o proxy; Meeko no envía cabeceras CORS.
- **Clientes de otro origen conocido**, como un panel en `https://admin.example.com`: añádalo a `SessionManager({ allowedOrigins })`, que ahora también vale para las mutaciones sin sesión.
- **Pruebas y scripts** que hacen `POST` con `fetch` de Node, `curl` o `executeApiRoute`/`executeRpc` sin `Origin`: añada `origin` con el origen de la aplicación (por ejemplo, `headers: { origin: "http://localhost:4173" }`). `createApiClient` y `createRpcClient` aceptan `headers` para hacerlo una vez.
- **Detrás de un proxy** que termina TLS, el servidor ve `http://` y el navegador envía un `Origin` `https://`: fije `MEEKO_PUBLIC_ORIGIN` (o `publicOrigin`). `MEEKO_TRUST_PROXY` no cambia el origen propio; sólo decide la dirección del cliente. Una aplicación así ya fallaba en `1.7` en las mutaciones con sesión.
- **`createLocalCalls`** envía ahora el origen de la aplicación como `Origin`, como los clientes `api.*` y `rpc.*` del SSR, en lugar de reenviar el de la petición original. Una mutación local desde una página pedida con `GET` (sin `Origin`) funciona, con o sin sesión; con sesión sigue necesitando el token CSRF de la petición original. Si una prueba esperaba un `403` por el `Origin` reenviado, ya no lo recibe.

`origin: "none"` es **inseguro**: deja la ruta expuesta al CSRF y al _login CSRF_ en las peticiones sin sesión. Una petición con sesión sigue exigiendo `Origin` y el token CSRF aunque la ruta lo declare, también en un formulario nativo (`Origin` y `_csrf`). `origin: "required"` sigue siendo válido y equivale al valor por defecto. Detalles en [framework.md](framework.md#origin-en-mutaciones-anónimas).

## Módulos por su nombre

Desde `1.8`, un módulo se registra sólo con su nombre en `modules` y sus opciones van en su propia clave de `meeko.config.ts`, como en Nuxt. Importar el módulo (`modules: [ui]`) y `[módulo, opciones]` quedan obsoletos: siguen funcionando en `1.x`, con el aviso `MEEK126`, y se retiran en `2.0`.

<!-- no-check -->

```ts
// Antes (1.7)
import i18n from '@meekojs/i18n/module'
import { defineMeekoConfig } from '@meekojs/meeko/framework'
import ui from '@meekojs/ui'

export default defineMeekoConfig({
	modules: [ui, [i18n, { defaultLocale: 'es', catalogs: { es: 'app/locales/es.json', en: 'app/locales/en.json' } }]],
	ui: { defaults: { button: { shape: 'pill' } } },
})
```

```ts
// Después (1.8)
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui', '@meekojs/i18n'],
	ui: { defaults: { button: { shape: 'pill' } } },
	i18n: { defaultLocale: 'es', catalogs: { es: 'app/locales/es.json', en: 'app/locales/en.json' } },
})
```

1. Sustituye cada módulo importado por su nombre (el del paquete o la ruta) y borra su `import`. `'@meekojs/i18n'` resuelve su subpath `./module`: no escribas `'@meekojs/i18n/module'`. El módulo integrado anterior es `'@meekojs/meeko/i18n'`, también con la clave `i18n`.
2. Mueve las opciones de cada `[módulo, opciones]` a la clave que declara su `meta.configKey`: `i18n` para `@meekojs/i18n`, `ui` para `@meekojs/ui`. El aviso `MEEK126` la nombra. Si un módulo no declara `configKey`, el aviso lo dice: mantén su tupla hasta que su autor la añada.
3. Añade `{ "path": "./.meeko/tsconfig.config.json" }` a `references` del `tsconfig.json` del proyecto (`meeko init` ya lo incluye), para que el editor tipe y complete las claves de los módulos.
4. Ejecuta `meeko check`. Desde `1.8` comprueba siempre los tipos de `meeko.config.ts` con los de sus módulos (antes, sólo cuando la carga fallaba): una opción mal tipada es `TS2322` con su línea, y un error que antes pasaba inadvertido, como `process.env` sin `@types/node`, también aparece.

Una clave de un módulo instalado que no está en `modules` (`i18n: { … }` sin `'@meekojs/i18n'`) es el aviso `MEEK127`, que nombra la entrada que falta; Meeko la ignora, como antes. Dos módulos con la misma `meta.configKey` son ahora un error.

**Autores de módulos.** Declara `meta.configKey` y amplía `MeekoConfig` con su tipo (`declare module '@meekojs/meeko/framework' { interface MeekoConfig { readonly seo?: SeoOptions } }`) en el archivo del export por defecto; Meeko carga esa ampliación sola en `.meeko/types/config.d.ts`. Si la raíz del paquete es su runtime, exporta el módulo en el subpath `./module`. Añade `"keywords": ["meeko-module"]` al `package.json` para que el editor complete su nombre. Véase [Módulos](framework.md#módulos).

## Desestructurar defineProps (opcional)

`1.8` admite desestructurar `defineProps` sin perder la reactividad (véase [Desestructurar las props](api.md#desestructurar-las-props)). No hace falta cambiar nada: `const props = defineProps<Props>()` sigue igual. Para adoptarlo en un componente:

1. Sustituye `const props = defineProps<Props>({ size: 'md' })` por `const { label, size = 'md', ...rest } = defineProps<Props>()`: los defaults pasan al patrón (con los dos a la vez es `MEEK124`).
2. Cambia cada `props.label` por `label` en el script y en la plantilla. Un nombre que ya usa una variable local o un parámetro sigue siendo esa variable: renombra la prop (`label: title`) si lo necesitas.
3. Si separabas props con `const { a, b, ...rest } = props` dentro de un `computed` para reenviar el resto con `bind`, usa el `...rest` de la desestructuración, que ya sigue a las props.
4. Ejecuta `meeko check`: `MEEK101` señala las copias que se leen una sola vez, `MEEK125` las asignaciones y `TS2344` un nombre que no es una prop.

Los defaults pueden leer ahora constantes de nivel superior de literales e imports; una variable del setup que antes daba `TS2304` es `MEEK123`.

## Tipos de un componente

`<Nombre>Props` ya no incluye los callbacks de `defineEmits`. Si tu código los lee o los escribe en ese tipo, cámbialo por `ComponentProps<"Nombre">`:

```diff
- const props: BaseButtonProps = { href: '/x', onClick }
+ const props: ComponentProps<'BaseButton'> = { href: '/x', onClick }
```

Sólo cambian los tipos, y `meeko check` señala cada caso con `TS2353` o `TS2339`. `BaseButtonEmits`, nuevo, es el mapa de `defineEmits`. Con esto se puede escribir un envoltorio; véase [Envolver otro componente](api.md#envolver-otro-componente).

Un paquete de componentes publicado antes de `1.8` sigue funcionando sin republicarlo y sin que hagas nada. Meeko lee lo que exporta su `.d.meeko.ts`: su `<Nombre>Props` es su `ComponentProps`, con los callbacks, como hasta ahora; `<Nombre>Emits` no existe para él, porque su declaración no trae el mapa de eventos, y usarlo da `TS2304`. Sus `Snippets`, `Models` y `Exposed` no cambian. Al republicarlo con `1.8` tendrá los dos tipos separados, igual que los `.meeko` de tu proyecto.

## Otros cambios visibles

- **`css` de un componente.** Con el plugin de Vite de Meeko, el export `css` es el CSS ya procesado por PostCSS en el grafo SSR y en `meeko dev`, y sigue siendo la cadena del compilador en el bundle de cliente de producción (véase [stability.md](stability.md#formato-meeko-y-módulo-generado)). Un test de Vitest que lea `Componente.css` o haga SSR de un componente sigue recibiendo un CSS no vacío: sin `test.css: true`, Vitest no procesa CSS y `css` es la cadena del compilador; con `css: true`, el CSS procesado.
- **`on:toggle` de un popover rápido.** Un `hint` de `<MeekoPopover>` o de `UIPopover` abierto y cerrado muy rápido emite ahora `toggle` `true` y después `false`; antes el navegador fusionaba los dos eventos y no se emitía nada. Si un manejador cuenta aperturas, ahora ve también estas.
- **Orden de los `<style>` de los componentes.** El SSR y el prerender los escriben al final del `<head>`, después de `app/styles/main.css`, de las hojas de los módulos y del `head` de `document`, como hace el cliente al hidratar. Antes iban delante, y una regla global con la misma especificidad que una con ámbito ganaba hasta que cargaba el JavaScript. Si una regla de `main.css` debía ganar a la de un componente, súbale la especificidad: tras hidratar ya ganaba la del componente.
- **`<input>` u otro `<select>` dentro de un `<select>`.** Ahora es `MEEK008`. Antes compilaba a un `<select>` vacío seguido de sus opciones sueltas, que es lo que el navegador hace con ese HTML. Saque esa etiqueta del `<select>`.

## ESLint: imports con orden natural por defecto

Al actualizar `@meekojs/eslint-plugin`, `defineEslint()` activa `perfectionist/sort-imports` y `perfectionist/sort-named-imports` con orden natural ascendente (`item2` antes que `item10`). Puedes ver nuevos avisos de imports desordenados; en Meeko 1.x son `warn` y en 2.0 pasarán a `error`. `eslint --fix` los resuelve. Si tu CI usa `--max-warnings 0`, estos avisos también hacen fallar su ejecución.

Para desactivarlos usa `defineEslint({ perfectionist: false })`. Para exigirlos como errores usa `defineEslint({ rules: { 'perfectionist/sort-imports': 'error', 'perfectionist/sort-named-imports': 'error' } })`; el override de severidad conserva el orden natural. Las reglas `perfectionist/*` ya no requieren declarar `perfectionist: true`, pero siguen rechazándose si lo desactivas explícitamente. Consulta las [opciones del plugin](../packages/eslint-plugin/README.md#ordenar-y-limpiar-imports).
