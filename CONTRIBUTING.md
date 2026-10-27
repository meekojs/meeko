# Contribuir a Meeko

## Convenciones

- Escribe código, identificadores, nombres de archivos y errores técnicos en inglés.
- Escribe JSDoc de las API públicas y la documentación para usuarios en español.
- Usa mensajes de commit en español, en modo imperativo y con una intención concreta. Ejemplos: `Agrega posiciones al parser de componentes` y `Corrige la hidratación de listas con claves`.
- Separa cambios funcionales, documentación y ajustes de formato cuando tengan objetivos independientes.

## Estructura

El repositorio es un workspace de pnpm con un único lockfile: el paquete `@meekojs/meeko` en `packages/meeko`, la extensión de VS Code en `packages/vscode`, la de Chrome DevTools en `packages/devtools` y el sitio en `apps/site`. La documentación (`docs/`) y el logo (`assets/brand/`) son del repositorio. Instala siempre desde la raíz.

## Verificación local

```powershell
pnpm install
pnpm run verify
pnpm run example:bundle
```

Las órdenes de la raíz reenvían al paquete (`pnpm -F @meekojs/meeko run <orden>`); para otra pieza usa su filtro, por ejemplo `pnpm -F meeko-language run test`. `verify` comprueba el código fuente y el ejemplo con TypeScript 7, ejecuta las pruebas y genera el componente de ejemplo. Una prueba de compilador debe demostrar también la salida SSR, la hidratación y un diagnóstico relevante cuando corresponda.

## Cambios al formato `.meeko`

Documenta cada nueva construcción en `docs/architecture.md`. La salida de servidor y la de navegador deben compartir semántica. Agrega un caso que pruebe HTML inicial, coincidencia de hidratación, actualización posterior y liberación de recursos.

Los archivos generados (`dist`, `*.generated.ts`, `*.bundle.js`) se mantienen fuera de Git. El código fuente de `.meeko` es la referencia para editar componentes.
