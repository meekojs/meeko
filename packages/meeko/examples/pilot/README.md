# Aplicación piloto

Bandeja de trabajo para validar Meeko con SSR real, hidratación, navegación por rutas, formularios, listas con claves, componentes anidados y datos asíncronos.

Desde la raíz del repositorio:

```powershell
pnpm run build
node dist/cli.js check examples/pilot/App.meeko
node dist/cli.js types examples/pilot/App.meeko
pnpm exec tsc -p examples/pilot/tsconfig.json --noEmit
pnpm run pilot:dev
```

Abre `http://127.0.0.1:4174`. El servidor de desarrollo usa Vite para transformar la misma fuente `.meeko` en SSR y cliente. La API `/api/tasks` responde después de 120 ms y añade una tarea remota de demostración.

Para generar y servir los artefactos de producción sin middleware Vite:

```powershell
pnpm run pilot:build
pnpm run pilot:serve
```

El build produce el cliente, un módulo SSR y un servidor HTTP independientes en `.output/`, que se ignora en Git. El servidor sólo importa el runtime y archivos compilados; no transforma código en cada petición.

Para probar el flujo en Chromium, Firefox y WebKit con Playwright:

```powershell
node node_modules/playwright-core/cli.js install chromium firefox webkit
pnpm run pilot:e2e
```

El test ejecuta el mismo recorrido en desarrollo y producción: comprueba el HTML antes de JavaScript, hidratación sin errores, interacción de tarjetas, formulario, filtro por ruta, actualización asíncrona y recuperación tras un fallo de red simulado. WebKit de Playwright comprueba ese motor, pero no sustituye una prueba en Safari real.
