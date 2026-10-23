# Contribuir a Meeko

## Convenciones

- Escribe código, identificadores, nombres de archivos y errores técnicos en inglés.
- Escribe JSDoc de las API públicas y la documentación para usuarios en español.
- Usa mensajes de commit en español, en modo imperativo y con una intención concreta. Ejemplos: `Agrega posiciones al parser de componentes` y `Corrige la hidratación de listas con claves`.
- Separa cambios funcionales, documentación y ajustes de formato cuando tengan objetivos independientes.

## Verificación local

```powershell
pnpm install
pnpm run verify
pnpm run example:bundle
```

`verify` comprueba el código fuente y el ejemplo con TypeScript 7, ejecuta las pruebas y genera el componente de ejemplo. Una prueba de compilador debe demostrar también la salida SSR, la hidratación y un diagnóstico relevante cuando corresponda.

## Cambios al formato `.meeko`

Documenta cada nueva construcción en `docs/architecture.md`. La salida de servidor y la de navegador deben compartir semántica. Agrega un caso que pruebe HTML inicial, coincidencia de hidratación, actualización posterior y liberación de recursos.

Los archivos generados (`dist`, `*.generated.ts`, `*.bundle.js`) se mantienen fuera de Git. El código fuente de `.meeko` es la referencia para editar componentes.
