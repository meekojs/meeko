# Pruebas y distribución

## Preparación y tipos

Ejecuta desde la raíz con Node.js 24+ y pnpm 12.14.0:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm check
pnpm check:apps
```

El build prepara los cinco paquetes públicos y sus entradas `dist/`, incluidas las que importa `eslint.config.ts`. Por eso precede al lint en un checkout limpio. `check` comprueba los paquetes y `check:apps`, las webs públicas del framework y de UI.

## Pruebas por categoría

| Categoría             | Comando                        | Alcance                                                     |
| --------------------- | ------------------------------ | ----------------------------------------------------------- |
| Núcleo                | `pnpm test`                    | Compilador, SSR, hidratación, framework y runtime.          |
| Paquetes              | `pnpm test:packages`           | UI, i18n y plugins ESLint/Prettier, usando el build previo. |
| Verificación ampliada | `pnpm verify`                  | Núcleo, ejemplos, tipos de pruebas, Vite y DevTools.        |
| Navegador del núcleo  | `pnpm e2e`                     | Interacciones e hidratación del motor.                      |
| Navegador de UI       | `pnpm -F @meekojs/ui test:e2e` | Demo con cards, tablas, modales y View Transitions.         |
| Web pública           | `pnpm -F meeko-site test`      | Referencias y contenido del sitio.                          |
| Distribución          | `pnpm package:workspace-smoke` | Todos los paquetes instalados desde tarballs.               |

Las pruebas UI usan Chrome instalado por defecto. En CI se usa Chromium de Playwright mediante `MEEKO_CHROME_PATH`; puedes establecer esa variable para elegir otro ejecutable compatible. Los escenarios UI se ejecutan secuencialmente porque algunos prueban HMR modificando y restaurando artefactos.

## Declaraciones y consumidor instalado

El build de UI genera declaraciones junto a cada `.meeko`. Al moverlas desde `.meeko/types`, reajusta sus imports relativos y añade extensiones ESM para NodeNext; las referencias a componentes conservan su extensión `.meeko`.

Las regresiones comprueban todas las declaraciones distribuidas sin `skipLibCheck`. El smoke crea el consumidor en el directorio temporal del sistema, fuera del workspace, para impedir que resuelva dependencias no declaradas desde el `node_modules` del repositorio. Comprueba exports, tipos, ESLint/Prettier, componentes y CSS procesado por el PostCSS del consumidor. No publica paquetes y conserva su carpeta temporal para diagnóstico.

La instalación del consumidor usa `--prefer-offline --ignore-scripts`: reutiliza el store y descarga lo que falte del registro, sin ejecutar scripts de instalación de terceros. Una caché local incompleta no debe confundirse con una dependencia disponible gracias al workspace.

## CI

La verificación principal construye antes de lint, comprueba paquetes y aplicaciones, ejecuta las pruebas del ecosistema y del núcleo y valida consumidores instalados. Los jobs existentes de Redis, Node/Bun/Deno/workerd y VS Code mantienen sus escenarios específicos. Los logs de fallo se conservan como artefactos; las pruebas locales no equivalen a una ejecución remota de Actions.
