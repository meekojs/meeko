# Web pública de Meeko i18n

Documentación de `@meekojs/i18n`, construida con Meeko, el módulo i18n real y Meeko UI. Comparte la identidad y la base documental privada `meeko-docs` con `apps/ui`. No necesita una base de datos.

## Desarrollo

Desde la raíz del monorepo, con Node.js 24+ y pnpm 12:

```powershell
pnpm install
pnpm build
pnpm i18n:dev
```

El servidor imprime la URL disponible. Para generar y servir el build Node:

```powershell
pnpm i18n:build
pnpm -F meeko-i18n-site start
```

El build genera `.meeko/output/node`. Estos comandos preparan y sirven el sitio; no lo despliegan automáticamente. El dominio y el adaptador se configuran mediante `meeko.config.ts`.

## Contenido

- `app/pages/`: instalación, mensajes, plurales, formatos, rutas, namespaces, RTL, API y validación.
- `app/components/TranslationLab.meeko`: laboratorio con señales e instancia real de `useI18n`.
- `app/locales/{es,en,ar}/`: catálogos `common` y `checkout`. `checkout` sólo se solicita en `/namespaces`.
- `app/utils/`: catálogo de navegación y ejemplos copiables.
- `packages/docs/`: shell compartido, componentes documentales, tokens, tipografía y logo. Los scripts preparan sus declaraciones y copian los recursos a `public/`, ignorado por Git.

El laboratorio está en `/playground` y `/{es,en,ar}/playground`. Las rutas localizadas validan el idioma en servidor; el módulo no genera esas rutas automáticamente. `switchLocale` realiza una navegación completa y conserva query/hash. Los controles locales se restablecen al cambiar de documento.

La documentación se mantiene en español y dirección LTR. El plugin publica `lang`/`dir` del idioma activo en el documento; el shell declara explícitamente español/LTR y el bloque traducido declara su propio idioma y dirección.

## Validación

```powershell
pnpm -F meeko-i18n-site check
pnpm -F meeko-i18n-site build
pnpm -F meeko-i18n-site test:e2e
```

El E2E arranca el build de producción en un puerto libre y verifica las guías, copia de código, interpolación, plurales, selectores, formatos, navegación entre idiomas, namespace diferido, RTL, menú móvil, 404 y lectura sin JavaScript. Requiere Chrome o `MEEKO_CHROME_PATH` apuntando a Chromium. Capturas y logs quedan bajo `.meeko/`.
