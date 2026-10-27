# Plan de desarrollo

Meeko 1.0 completa el alcance previsto para la primera versión estable. Desde ahí, la [política de estabilidad](stability.md) rige qué puede cambiar en cada versión. Este plan resume lo entregado y enumera las ampliaciones previstas para la serie 1.x. Ninguna tiene fecha comprometida. Los detalles de cada versión están en el [CHANGELOG](../packages/meeko/CHANGELOG.md), y la preparación de la publicación, en [releasing.md](releasing.md).

## Entregado en 1.0

- **Motor de componentes**:
  - parser con AST propio y diagnósticos ubicados en el `.meeko`;
  - atributos, condiciones, listas con claves y componentes anidados;
  - `<style scoped>` con `:global(...)`;
  - SSR, hidratación con transferencia de estado y señales;
  - plugin de Vite con HMR.

  La raíz del paquete sólo expone la API pública documentada.
- **Editor.** El servidor de lenguaje (`meeko lsp --stdio`, `meeko-language-server`) ofrece los mismos diagnósticos que `meeko check`, además de completado, navegación, renombrado entre archivos, formato y acciones rápidas. La extensión de VS Code 1.0.0 es su cliente, y [editors.md](editors.md) documenta Neovim, Helix, Zed, JetBrains y Sublime Text.
- **DevTools.** El protocolo 1 lo comparten el panel integrado y la extensión de Chrome 1.0.0. Permite editar señales y muestra en la línea de tiempo dónde se lee y se escribe cada una ([devtools.md](devtools.md)).
- **Framework full-stack**:
  - rutas por archivos, layouts, middleware y autoimports;
  - API, RPC y Socket tipados con Standard Schema;
  - estado por petición, sellado tras el render.
- **Modos de render.** `"ssr"`, `"stream"` (streaming SSR con `defer`), `"prerender"` y `"client"`, con navegación transaccional entre ellos.
- **Servidor portable.** `@meekojs/meeko/server` sólo usa Web APIs. Lo acompañan los adaptadores Node, Bun, Deno y Cloudflare Workers, una salida de build autónoma por adaptador y una suite de conformidad común que se ejecuta en CI.
- **Sesiones y Socket distribuidos.** La revocación aborta las peticiones en curso y cierra los sockets de la familia. Los broadcasts se distribuyen con Redis o Durable Objects, con colas acotadas por peer.
- **Publicación.** El paquete se publica en npm con procedencia (OIDC), y las prereleases van al dist-tag `next`. Hay workflows para Visual Studio Marketplace, Open VSX y Chrome Web Store.

## Después de 1.0

Todas estas ampliaciones son aditivas. Pueden llegar en un minor sin romper aplicaciones existentes.

- **Enviar el HTML antes del loader.** Hoy una página `"stream"` espera al loader crítico antes del primer byte. La ampliación enviaría antes el inicio del documento (`<head>`, estilos y entrada cliente).
- **Shell SPA puramente estático.** Una aplicación cuyas páginas son todas `render: "client"` podría servirse como archivos estáticos, sin servidor que ejecute middleware ni layouts.
- **Rendimiento de hidratación de listas.** La [comparativa con Vue](benchmarks.md#escenarios-ampliados-árbol-lista-y-navegación) muestra la hidratación de listas por encima de Vue, y también falta acelerar el montaje completo de vistas. Es trabajo de rendimiento: no cambia la API.
- **Middleware de layers y módulos.** Hoy el descubrimiento de `app/middleware` y `server/middleware` se limita al proyecto raíz.
- **Contenido inline en `<component>`.** Es una sintaxis para pasar contenido dentro de la etiqueta, como alternativa a una prop `Component<Props>`.
- **Extensiones en las tiendas.** Falta dar de alta las cuentas y secretos que necesitan los workflows ya preparados ([releasing.md](releasing.md#publicación-en-las-tiendas-de-extensiones)).

## Etapas anteriores

Las versiones `0.0.1` a `0.1.0` construyeron este alcance por etapas:

1. parser y diagnósticos;
2. plantillas completas;
3. SSR e hidratación robustos;
4. tipado y editor;
5. integración con Vite y comparativas;
6. DevTools;
7. framework full-stack.

El [CHANGELOG](../packages/meeko/CHANGELOG.md) y las secciones por versión de [releasing.md](releasing.md) registran qué incluyó cada una y cómo se verificó.
