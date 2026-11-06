# Inicio rápido

En unos minutos tendrás una página renderizada en el servidor y un botón que responde en el navegador. Este recorrido usa Meeko Framework, que añade rutas y servidor al motor de componentes `.meeko`.

## Requisitos

Necesitas **Node.js 24 o posterior**, acceso a npm y un terminal. `npm exec` descarga la CLI publicada sin instalación global; todos los comandos usan npm.

<a id="create-a-full-stack-application"></a>

## Crear una aplicación full-stack

Desde la carpeta donde quieras crear `my-app`, ejecuta:

```powershell
npm exec --yes --package=@meekojs/meeko@1.9.0 -- meeko init-framework my-app
cd my-app
npm install
npm run dev
```

Abre `http://localhost:4173`. Verás «Welcome to Meeko» y «Count: 0». Pulsa el botón: el número aumenta sin recargar la página. La CLI fija la versión publicada en el `package.json` generado.

<a id="desarrollo"></a>

## Cambiar la primera página

Abre `my-app/app/pages/index.meeko` y sustituye `Welcome to Meeko` dentro de `<h1>` por `Mi primera página`. Guarda el archivo y comprueba el título nuevo en el navegador. El mismo componente contiene la señal `count` y el evento `on:click`.

Para verificar los tipos, detén el servidor con Ctrl+C y ejecuta desde `my-app`:

```powershell
npm run check
```

## Si algo falla

- Si falta `npm`, instala Node.js 24 o posterior antes del primer comando.
- Si Node es anterior a 24, actualízalo antes de ejecutar la CLI.
- Si el puerto 4173 está ocupado, abre la dirección que imprime `npm run dev`.
- Si la CLI rechaza el destino, elige un nombre de carpeta nuevo; no sobrescribe una aplicación existente.

<a id="crear-una-aplicación-ssr"></a>

## Si sólo necesitas el motor

`meeko init` crea una aplicación SSR pequeña sin el enrutador del framework. Desde una carpeta limpia puedes ejecutar `npm exec --yes --package=@meekojs/meeko@1.9.0 -- meeko init engine-app`, entrar en `engine-app`, instalar con `npm install` y arrancar con `npm run dev`. Elige esta ruta si quieres integrar componentes `.meeko` en lugar de organizar páginas y servidor con el framework.

Continúa con [Primera aplicación](primeros-pasos.md) para crear una segunda página y distinguir servidor y navegador. Si sólo necesitas el motor `.meeko` dentro de Vite, consulta [el modelo de componentes](api.md) y [sus exports](/docs/reference/exports).
