# Páginas de la referencia de la API

Esta carpeta es la fuente de `/docs/reference` del sitio. Tiene dos piezas:

- **`taxonomy.json`**: los grupos del aside (Componentes, Macros, Composables…) con cada símbolo, en orden de lectura, y su estado. Un símbolo con `"pending": true` todavía no tiene página escrita: el sitio enlaza su página generada desde el JSDoc, o su `fallback`.
- **`<grupo>/<slug>.md`**: una página escrita por símbolo. El sitio la fusiona con lo que genera desde el código fuente (`apps/site/server/content/reference.ts`).

Los modelos que hay que imitar son [`composables/useform.md`](composables/useform.md), [`components/meekolink.md`](components/meekolink.md) y [`macros/definepage.md`](macros/definepage.md).

## Escribir una página

1. Elige un símbolo pendiente de `taxonomy.json`.
2. Crea `docs/reference/<id del grupo>/<slug>.md`. El slug es el último segmento de la URL:
   - si el primer símbolo tiene página generada (un export o la sintaxis de `.meeko`), es el slug de esa página, para que su URL no cambie: `useForm` → `useform`, `<MeekoLink>` → `meekolink`, `ApiError` → `apierror` (míralo en la URL actual de `/docs/reference/…`);
   - si no la tiene (un comando, una clave de la configuración o un cliente generado), es el `slug` de la entrada en `taxonomy.json`: `meeko-dev`, `config-server`.
3. Quita `"pending": true` de la entrada.
4. Comprueba con `pnpm -F meeko-site run test` (véase [Comprobaciones](#comprobaciones)).

Verifica cada afirmación en el código de `packages/meeko/src` y en sus pruebas, no sólo en las guías. Los errores de la sección «Errores comunes» deben ser los reales: copia el código `MEEKxxx`, el `TSxxxx` o el mensaje que da `meeko check`, el descubrimiento de rutas, `meeko build` o la ejecución. Si no lo has visto fallar, no lo escribas.

## Frontmatter

```yaml
---
title: useForm
group: composables
since: 1.2.0
description: Estado de un formulario en un componente, con una señal por campo y validación con un Standard Schema.
symbols:
  - "@meekojs/meeko/framework#useForm"
types:
  - "@meekojs/meeko/framework#Form"
signature: first
related:
  - "@meekojs/meeko/framework#ClientError"
  - docs/framework.md#formularios-useform
---
```

| Clave | Obligatoria | Valor |
| --- | --- | --- |
| `title` | sí | Nombre del símbolo tal como se escribe: `useForm`, `<MeekoLink>`, `meeko dev`. |
| `group` | sí | El id del grupo, que es también la carpeta. |
| `since` | sí | Versión en que apareció, como `1.2.0`. Si el JSDoc tiene `@since`, debe coincidir. |
| `description` | sí | Una línea, sin enlaces: el subtítulo de la página, la `<meta name="description">`, el índice y `llms.txt`. |
| `symbols` | sí | Los símbolos que documenta, por id (véase abajo). El primero es el de la página y debe ser el de su entrada en `taxonomy.json`. |
| `types` | no | Más declaraciones para la sección «Tipo», como las interfaces de las opciones o del valor devuelto. |
| `signature` | no | `first`: «Tipo» muestra sólo la primera sobrecarga del primer símbolo, para funciones con sobrecargas internas, como `definePage`. |
| `related` | no | Símbolos (por id) y secciones de las guías (`docs/framework.md#ancla`) para «Relacionado». |

### Ids de los símbolos

| Id | Qué es | Se comprueba contra |
| --- | --- | --- |
| `@meekojs/meeko/framework#useForm` | Un export de una subruta pública | Los exports de `packages/meeko/package.json#exports`, con TypeScript |
| `syntax:meekolink` | Sintaxis de `.meeko`: etiquetas, macros del script, directivas y bloques, por el slug de su página generada | `apps/site/server/content/api-builtins.ts` |
| `autoimport:useApi` | Un cliente generado que se autoimporta: `api`, `rpc`, `socket`, `useApi`… | `packages/meeko/src/autoimports.ts` |
| `cli:dev`, `cli:auth hash` | Un comando de la CLI | El texto de ayuda de `packages/meeko/src/cli.ts` |
| `config:server` | Una clave de `meeko.config.ts` | Los miembros de `MeekoConfig` |

## Estructura de la página

Debajo del frontmatter, la página empieza con la **descripción** (uno o dos párrafos, sin encabezado) y sigue con estas secciones `##`, en este orden y con estos títulos:

1. **`## Uso`**: el ejemplo mínimo que funciona, completo (con la ruta del archivo en un comentario en la primera línea).
2. **Tipo**: no la escribas. El sitio la genera después de «Uso» con las firmas y declaraciones exactas de `symbols` y `types`, así que nunca se desincroniza del paquete.
3. **`## Parámetros`**, **`## Props`**, **`## Opciones`** o **`## Atributos`**: una tabla con `Tipo`, `Por defecto` y `Descripción`. Escribe los tipos como los ve quien usa el símbolo; los exactos están en «Tipo».
4. **`## Valor devuelto`** o, para una etiqueta, un comando o la sintaxis, **`## Resultado`**: qué devuelve o qué produce (el HTML, los archivos, la salida).
5. **`## Ejemplos`**: casos de uso reales, uno por `###`, de menos a más.
6. **`## Errores comunes`**: un `###` por error, cada uno con el código incorrecto, por qué falla (con el código `MEEKxxx`, `TSxxxx` o el mensaje real) y la versión correcta.
7. **`## Notas`**: servidor o cliente, SSR, hidratación, rendimiento, seguridad y accesibilidad, en una lista con el tema en negrita.
8. **Relacionado**: no la escribas. El sitio la genera desde `related`.

Dentro de cada sección puedes usar `###`, tablas, listas y avisos. No añadas otras secciones `##`.

### Bloques «Correcto» e «Incorrecto»

En «Errores comunes», marca cada bloque después del lenguaje:

````markdown
```html bad
<input model="form.fields.name.value">
```

`meeko check` da `TS2322: …`.

```html good
<input model="form.fields.name">
```
````

`bad` muestra el bloque como «Incorrecto» y `good` como «Correcto». Cada `###` de «Errores comunes» necesita al menos uno de cada; para una estructura de archivos usa `text bad` y `text good`.

### Avisos

Usa la sintaxis de GitHub, que el sitio dibuja como un aviso:

```markdown
> [!NOTE]
> `meeko check` comprueba `initial` contra la entrada del schema.
```

Admite `[!NOTE]` (nota), `[!TIP]` (consejo), `[!IMPORTANT]` (importante), `[!WARNING]` (advertencia) y `[!CAUTION]` (cuidado). Resérvalos para lo que el lector no debe pasar por alto; lo demás va en «Notas».

### Ejemplos que se comprueban

Los bloques ` ```ts ` que no son `bad` se compilan con TypeScript contra el `@meekojs/meeko` del repositorio en las comprobaciones, así que deben ser autocontenidos: con sus imports y sin depender de archivos del proyecto. Si un bloque no puede serlo (usa `valibot`, un cliente generado como `api` o un fragmento), escribe `<!-- no-check -->` en la línea anterior. Los bloques `html` (componentes `.meeko`) no se compilan: compruébalos con `meeko check` en un proyecto antes de escribirlos.

## Comprobaciones

```powershell
pnpm -F meeko-site run test
```

`apps/site/tests/reference.test.mjs` comprueba:

- que cada símbolo de `taxonomy.json` y del frontmatter (`symbols`, `types`, `related`) existe en los exports, la sintaxis de `.meeko`, los autoimports, la CLI o la configuración;
- que cada página tiene su frontmatter, que su carpeta, su slug y su primer símbolo son los de su entrada en `taxonomy.json`, y que su `since` coincide con el `@since` del JSDoc;
- que cada página tiene las secciones en el orden de arriba, sin «Tipo» ni «Relacionado», y que cada error común tiene un bloque `bad` y uno `good`;
- que un símbolo sin página está marcado `pending` y uno con página no lo está: la lista de pendientes sólo puede vaciarse;
- que los `fallback` y las secciones de las guías de `related` existen;
- que los bloques `ts` comprobables compilan.

## Para los modelos de lenguaje

El build del sitio publica [`/llms.txt`](https://meeko.diegootayza.com/llms.txt), el índice con un enlace y una línea por cada guía y cada símbolo, y [`/llms-full.txt`](https://meeko.diegootayza.com/llms-full.txt), las guías y la referencia completas en Markdown: las páginas escritas con su «Tipo» generado y los símbolos pendientes con su JSDoc.
