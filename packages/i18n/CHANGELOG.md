# Cambios de Meeko i18n

## Sin publicar

- **Se registra por su nombre.** `modules: ['@meekojs/i18n']` con las opciones en la clave `i18n` (`configKey: 'i18n'`), tipadas sin importar el módulo: el módulo amplía `MeekoConfig` y Meeko `1.8` carga esa ampliación en `.meeko/types/config.d.ts`. `'@meekojs/i18n'` resuelve el subpath `@meekojs/i18n/module`, que se conserva. El `package.json` declara la palabra clave `meeko-module`, con la que el editor completa su nombre. Importar el módulo en `meeko.config.ts` y `[módulo, opciones]` quedan obsoletos en Meeko `1.8` (`MEEK126`); véase [Actualizar de 1.7 a 1.8](../../docs/migration-1.8.md#módulos-por-su-nombre).
