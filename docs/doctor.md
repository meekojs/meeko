# Diagnóstico del proyecto

`meeko doctor` inspecciona el entorno local sin ejecutar la configuración ni los módulos de la aplicación, cargar `.env`, lanzar el LSP, conectarse a servicios o modificar archivos.

```sh
pnpm exec meeko doctor
pnpm exec meeko doctor apps/meeko
pnpm exec meeko doctor apps/meeko --json
```

## Qué comprueba

- Versión de Node y requisito de Node 24 o superior.
- `package.json` y gestor de paquetes declarado.
- Versiones y resolución local de Meeko, UI, i18n, plugins, TypeScript, Vite, ESLint y Prettier.
- Archivo de configuración y referencias estáticas de módulos y layers.
- Presencia de tsconfigs, tipos de rutas y entrada cliente generados en `.meeko`.
- Disponibilidad del servidor de lenguaje instalado con Meeko en el proyecto.

## Interpretar el resultado

`OK` confirma una comprobación; `AVISO` pide revisar un estado que puede ser normal, como dependencias opcionales ausentes o un proyecto aún sin preparar. `ERROR` indica un requisito incumplido. Los errores devuelven código de salida 1; los avisos no.

El JSON tiene `schemaVersion: 1`, información de paquetes, configuración, artefactos, LSP y una lista de comprobaciones con IDs y estados. Sirve para adjuntar un diagnóstico a una incidencia o procesarlo en scripts. No incluye valores de `.env`, opciones de módulos ni contenido de catálogos.

## Límites y siguientes pasos

La lectura es estática: módulos importados, funciones y expresiones dinámicas no se ejecutan ni se enumeran como si estuvieran cargados. La existencia de un archivo generado no garantiza su frescura; `meeko check` prepara y valida el proyecto cuando necesitas comprobarlo completamente.

La elección efectiva del LSP depende de la confianza del workspace y los ajustes de VS Code. Doctor informa qué servidor del proyecto está disponible; no afirma que el editor lo esté ejecutando ni modifica extensiones.

Si faltan artefactos, ejecuta `pnpm exec meeko routes` o `pnpm exec meeko check`. Si faltan dependencias, instala desde la raíz del workspace. Consulta [Editores](editors.md), [Tooling](tooling.md) y [Pruebas](testing.md) para los flujos correspondientes.
