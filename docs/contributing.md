# Contribuir a Meeko: pruebas, herramientas y rendimiento

Esta página reúne los comandos del monorepo. Las aplicaciones instaladas usan las guías de [pruebas](testing.md), [herramientas](tooling.md) y [rendimiento](performance.md).

## Pruebas del monorepo

### Preparación y tipos

Ejecuta desde la raíz con Node.js 24+ y pnpm 12.14.0:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm check
pnpm check:apps
```

El build prepara los seis paquetes públicos, la base documental privada y sus entradas `dist/`, incluidas las que importa `eslint.config.ts`. Por eso precede al lint en un checkout limpio. `check` comprueba los paquetes y `check:apps`, las webs públicas del framework, UI e i18n.

### Pruebas por categoría

| Categoría             | Comando                                                             | Alcance                                                        |
| --------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| Núcleo                | `pnpm test`                                                         | Compilador, SSR, hidratación, framework y runtime.             |
| Paquetes              | `pnpm test:packages`                                                | UI, i18n y plugins ESLint/Prettier, usando el build previo.    |
| Verificación ampliada | `pnpm verify`                                                       | Núcleo, ejemplos, tipos de pruebas, Vite y DevTools.           |
| Navegador del núcleo  | `pnpm e2e`                                                          | Interacciones e hidratación del motor.                         |
| Navegador de UI       | `pnpm -F @meekojs/ui test:e2e`                                      | Web UI, Container, cards, tablas, modales y View Transitions.  |
| Web i18n              | `pnpm -F meeko-i18n-site build && pnpm -F meeko-i18n-site test:e2e` | Build de producción, catálogos reales, cambio de idioma y RTL. |
| Web pública           | `pnpm -F meeko-site test`                                           | Referencias y contenido del sitio.                             |
| Distribución          | `pnpm package:workspace-smoke`                                      | Todos los paquetes instalados desde tarballs.                  |

Las pruebas UI usan Chrome instalado por defecto. En CI se usa Chromium de Playwright mediante `MEEKO_CHROME_PATH`; puedes establecer esa variable para elegir otro ejecutable compatible. Los escenarios UI se ejecutan secuencialmente porque algunos prueban HMR modificando y restaurando artefactos.

### Declaraciones y consumidor instalado

El build de UI genera declaraciones junto a cada `.meeko`. Al moverlas desde `.meeko/types`, reajusta sus imports relativos y añade extensiones ESM para NodeNext; las referencias a componentes conservan su extensión `.meeko`.

Las regresiones comprueban todas las declaraciones distribuidas sin `skipLibCheck`. El smoke crea el consumidor en el directorio temporal del sistema, fuera del workspace, para impedir que resuelva dependencias no declaradas desde el `node_modules` del repositorio. Comprueba exports, tipos, ESLint/Prettier, componentes y CSS procesado por el PostCSS del consumidor. No publica paquetes y conserva su carpeta temporal para diagnóstico.

La instalación del consumidor usa `--prefer-offline --ignore-scripts`: reutiliza el store y descarga lo que falte del registro, sin ejecutar scripts de instalación de terceros. Una caché local incompleta no debe confundirse con una dependencia disponible gracias al workspace.

### CI

La verificación principal construye antes de lint, comprueba paquetes y aplicaciones, ejecuta las pruebas del ecosistema y del núcleo y valida consumidores instalados. Los jobs existentes de Redis, Node/Bun/Deno/workerd y VS Code mantienen sus escenarios específicos. Los logs de fallo se conservan como artefactos; las pruebas locales no equivalen a una ejecución remota de Actions.

## Herramientas del workspace

### Desarrollo del workspace

Instala dependencias con `pnpm install` y luego ejecuta `pnpm build`. La configuración raíz usa los propios paquetes `@meekojs/eslint-plugin` y `@meekojs/prettier-plugin` del workspace, así que hay que construirlos antes de lint o formato en un checkout limpio. `pnpm tooling:build` construye sólo el núcleo y los paquetes de herramientas.

### Builds de paquetes

Los paquetes de núcleo, UI, i18n, ESLint y Prettier usan `scripts/build-package.mjs`. esbuild emite JavaScript ESM y mapas de código fuente. TypeScript comprueba el código y emite declaraciones. El plugin ESLint usa TypeScript 6 por compatibilidad con su API del compilador; los otros paquetes conservan TypeScript 7.

Usa imports relativos sin extensión en el código TypeScript:

```ts
import { signal } from './core/reactivity'
```

El build conserva la estructura de módulos fuente y escribe extensiones `.js` en los imports de runtime y declaraciones. Así mantiene estables los recursos de `import.meta.url`, los límites navegador/servidor y el estado compartido entre exports públicos. Las dependencias npm permanecen externas. Los tipos publicados también admiten consumidores con resolución `NodeNext`.

Las URL de recursos en runtime, los imports de archivos JavaScript reales, el código generado y los imports desde `dist` aún necesitan sus extensiones reales. Los archivos de configuración TypeScript cargados directamente por Node usan `.ts` al importar otra configuración.

`pnpm test:build` comprueba identidad de módulos compartidos, recursos relativos, cabeceras CLI y compatibilidad de declaraciones publicadas.

`pnpm package:workspace-smoke` empaqueta los seis paquetes, los instala en un consumidor nuevo, carga cada entrada pública y comprueba un consumidor TypeScript 7 con `NodeNext`. Ese consumidor usa `skipLibCheck`, como las apps Meeko generadas, porque las declaraciones de TypeScript-ESLint hacen referencia a la API del compilador TypeScript 6. La regresión del build comprueba por separado los imports de declaraciones locales emitidas.

### Lint y formato

- `pnpm lint`: revisa archivos JavaScript, TypeScript y Meeko del workspace.
- `pnpm lint:fix`: aplica correcciones ESLint, incluido el orden de imports y la eliminación de imports sin uso.
- `pnpm format:check`: comprueba el formato del workspace.
- `pnpm format`: formatea el workspace con Prettier.

El `eslint.config.ts` raíz usa [`defineEslint`](eslint.md): Perfectionist ordena sólo los imports y unused-imports elimina los que no se usan. Los globales de runtime y las excepciones de pruebas se limitan a sus archivos. Se excluyen fixtures, código generado, salidas de build y estado local de herramientas.

El `prettier.config.ts` raíz carga los plugins de Meeko, orden CSS y package.json. El sitio lo hereda; UI añade ordenación de clases basada en hojas de estilo. Los archivos existentes no se reformatean automáticamente al añadir o cambiar la configuración compartida.

Los ajustes de VS Code del workspace activan correcciones ESLint y formato al guardar explícitamente. Instala las extensiones recomendadas ESLint, Prettier y Meeko Language. Meeko Language formatea los `.meeko` con la configuración Prettier del proyecto.

## Presupuesto de rendimiento del repositorio

### Medición reproducible

Desde la raíz del monorepo, con Node.js 24+ y Chrome instalado:

```powershell
pnpm -F @meekojs/meeko benchmark:measure
pnpm -F @meekojs/meeko benchmark:compare --fail-on-regression
```

`benchmark:measure` construye el núcleo y genera `packages/meeko/.meeko/performance/current.json`. `benchmark:compare` escribe `comparison.json` en esa misma carpeta. `benchmark:budget` ejecuta ambos pasos y devuelve un código distinto de cero si detecta una regresión comparable. Ningún comando actualiza la baseline automáticamente.

El escenario usa un componente fijo con contador y 30 filas, comprueba SSR y verifica un clic después de hidratar en Chromium. No representa el tamaño ni la latencia de una aplicación de usuario completa. Los informes registran versiones de Node, navegador y esbuild, plataforma, arquitectura, CPU, revisión de Git, estado sucio y hash de los escenarios.

### Categorías de métricas

| Métrica                     | Qué mide                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `compile.cold`              | Primera compilación dentro de un worker nuevo; excluye arrancar el worker e importar el compilador. |
| `compile.warm`              | Compilaciones completas del componente modificado, tras calentamiento; no supone caché incremental. |
| `ssr.render`                | `renderWithState` completo de una instancia nueva.                                                  |
| `client.hydration`          | Tiempo dentro de `hydrate` en un navegador real; después se comprueba el evento del botón.          |
| `bundle.raw`, `bundle.gzip` | Bytes del cliente del escenario, compilado y minificado con esbuild, sin sourcemap.                 |
| `lsp.completion.cold`       | Primer completado de un proyecto LSP recién creado; excluye su descubrimiento inicial.              |
| `lsp.completion.warm`       | Completados repetidos sobre ese documento, con el programa TypeScript preparado.                    |

El LSP trabaja con una pequeña aplicación temporal y los tipos de `dist`, no con la complejidad de un consumidor real. Los sistemas de archivos y las cachés del sistema operativo pueden estar calientes incluso al crear un worker o servicio nuevo. La mediana y p95 se calculan sobre todas las muestras, sin quitar extremos. Hay siete rondas y dos calentamientos; las mediciones frías usan tres instancias nuevas. Se pueden cambiar con `--rounds`, `--warmups` y `--cold-rounds`.

Para usar Chromium descargado por Playwright, establece `MEEKO_BROWSER_CHANNEL=chromium`. Para un ejecutable propio usa `MEEKO_CHROME_PATH`. El runner libera su navegador, servidor y carpeta temporal al terminar. No ejecuta el editor ni modifica los proyectos consumidores.

### Presupuestos y comparación

`packages/meeko/benchmarks/performance-budgets.json` define el aumento relativo permitido y un incremento absoluto mínimo por unidad o métrica. Los valores iniciales son 35% y 0,05 ms para tiempos, 5% y 256 bytes para tamaños. Compilación fría y completado tienen mínimos específicos para no bloquear por variaciones pequeñas.

Una regresión debe superar ambos límites en **mediana y p95**. Una muestra lenta aislada no basta. Los tiempos sólo bloquean cuando coinciden Node, plataforma, arquitectura, CPU y versión del navegador; otro entorno aparece como `different-environment`. Los tamaños se comparan siempre porque no dependen del reloj. Un escenario distinto, una métrica ausente o una unidad cambiada rechaza la comparación en vez de declarar éxito.

La CI ejecuta `benchmark:budget` y conserva los informes incluso si falla. En un runner distinto a la máquina que capturó la baseline, los tiempos quedan como información y los tamaños siguen sujetos al presupuesto. Para evaluar una regresión temporal entre revisiones, mide ambas en el mismo runner y con la misma herramienta; evita imponer cifras absolutas universales.

### Actualizar una baseline

La baseline versionada es `packages/meeko/benchmarks/performance-baseline.json`. Tras revisar un cambio de escenario, versión de herramienta o coste deliberado:

```powershell
pnpm -F @meekojs/meeko benchmark:measure
Copy-Item packages/meeko/.meeko/performance/current.json packages/meeko/benchmarks/performance-baseline.json
```

Revisa las diferencias del informe junto con el cambio que justifica el nuevo coste. El comparador acepta `--baseline`, `--current`, `--budgets` y `--output` para comparar otras capturas sin sustituir la referencia. Si cambia el trabajo medido, actualiza la versión del escenario además de su fuente para que el hash impida comparar cargas distintas.

Los benchmarks históricos `benchmark`, `benchmark:scenarios` y `benchmarks/stability-baseline.mjs` continúan disponibles para comparaciones ampliadas, memoria, HMR y consumidores externos. Este presupuesto pequeño es una señal adicional; no sustituye las pruebas funcionales ni una medición representativa del consumidor.
