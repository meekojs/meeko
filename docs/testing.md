# Probar una aplicación Meeko

## Probar una aplicación instalada

En un proyecto externo, instala Meeko y ejecuta sus comprobaciones desde la raíz de **tu aplicación**:

```sh
pnpm add @meekojs/meeko
pnpm exec meeko check .
pnpm exec meeko build .
```

`check` prepara y comprueba el proyecto; `build` verifica la salida de producción. Ejecuta las pruebas propias de tu aplicación con el runner que hayas elegido. Los comandos del monorepo están en [Contribuir a Meeko](contributing.md#pruebas-del-monorepo).

### Probar una interacción en el navegador

Playwright puede comprobar la página generada y su hidratación sin una utilidad de test específica de Meeko. Desde la raíz de **tu aplicación**:

```sh
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

**Archivo nuevo: `playwright.config.ts`:**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'pnpm exec meeko dev .',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
})
```

**Archivo nuevo: `tests/home.spec.ts`**, para el contador del starter generado por `meeko init-framework`:

```ts
import { expect, test } from '@playwright/test'

test('el contador responde después de hidratarse', async ({ page }) => {
  await page.goto('/')
  const button = page.getByRole('button', { name: 'Count: 0' })
  await expect(button).toBeVisible()
  await button.click()
  await expect(page.getByRole('button', { name: 'Count: 1' })).toBeVisible()
})
```

Ejecuta `pnpm exec playwright test`. En CI, instala dependencias y Chromium, y ejecuta `pnpm exec meeko check .`, `pnpm exec meeko build .` y `pnpm exec playwright test` desde el directorio de la aplicación. Si cambiaste el contador durante el tutorial, ajusta el test a la interacción real de tu página.

## Pruebas del repositorio

La [matriz de pruebas del monorepo](contributing.md#pruebas-del-monorepo) incluye núcleo, paquetes, navegador, distribución y CI.
