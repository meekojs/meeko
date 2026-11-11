# Componentes y lenguaje .meeko

Esta página describe el contrato público del motor de componentes, que ejercitan los ejemplos y las pruebas. La [política de estabilidad](stability.md) indica qué cubre SemVer en la serie 1.x.

Esta guía cubre el motor de componentes independiente. Las convenciones de `app/`, rutas, middleware, API, RPC, Socket y sesiones están en la [guía del framework](framework.md).

Para empezar, crea un componente con un `<template>` y, cuando necesites estado o eventos, añade un `<script lang="ts">`. Este contador funciona tanto en el motor aislado como dentro de una aplicación del framework:

```html
<script lang="ts">
	import { signal } from '@meekojs/meeko'

	const count = signal(0)
</script>

<template>
	<button on:click="() => count.value++">{count.value}</button>
</template>
```

El script se ejecuta al crear el componente; la plantilla lee `count.value` y el evento actualiza la señal. Para recibir datos del padre, usa `const props = defineProps<{ label: string }>()` y lee `props.label` en la plantilla. [Props reactivas](component-basics.md#props-reactivas), [model](component-template.md#controles-de-formulario-con-model) y [listas](component-template.md#listas-con-y-sin-eachkey) cubren los siguientes casos habituales. Las secciones posteriores detallan el contrato de compilación y las opciones avanzadas.

## Explora por tema

Estas guías conservan los ejemplos y contratos completos de la antigua página API:
- [Componentes y props](component-basics.md)
- [Plantillas y directivas](component-template.md)
- [Estilos de componentes](component-styles.md)
- [Componentes y etiquetas dinámicos](component-dynamic.md)
- [Atributos y props estáticas](component-attributes.md)
- [Eventos, modelos y snippets](component-events.md)
- [Composición y módulo generado](component-advanced.md)
- [Reactividad y ciclo de vida](language-reactivity.md)
- [Componentes integrados](component-builtins.md)

## Herramientas

`meeko check archivo.meeko` comprueba sintaxis y tipos; `--json` entrega diagnósticos estructurados. `meeko compile entrada.meeko salida.ts` genera el módulo tipado y no escribe un archivo si hay errores. `meeko types archivo.meeko` emite declaraciones `Archivo.d.meeko.ts` para ese componente y los hijos importados bajo `.meeko/types/`, reflejando su ruta relativa al proyecto; no escribe declaraciones junto a las fuentes. En una aplicación de framework, la generación registra sus salidas en `.meeko/manifests/component-types.json` y elimina únicamente declaraciones administradas cuyo componente ya no existe. La primera ejecución tras actualizar reconoce mediante AST únicamente declaraciones generadas huérfanas de versiones anteriores, mientras conserva archivos ajenos y regenera los componentes vigentes. Para resolver esos imports con props precisas, TypeScript necesita `allowArbitraryExtensions` y `rootDirs` que superponga el árbol fuente con `.meeko/types/`. `meeko init` escribe esa configuración; un consumidor configurado a mano debe incorporarla. El plugin `@meekojs/meeko/vite` compila los imports `.meeko` en cliente y SSR y añade HMR y CSS durante desarrollo. `meeko lsp --stdio` (también disponible como bin `meeko-language-server`) arranca el servidor de lenguaje que usan la [extensión de VS Code](../packages/vscode/README.md) y [otros editores](editors.md) para ofrecer las mismas comprobaciones en el editor.

`@meekojs/meeko/prettier` es el plugin de Prettier para `.meeko`. Con `{ "plugins": ["@meekojs/meeko/prettier"] }` en la configuración de Prettier, `prettier --write "**/*.meeko"` formatea script, `<script server>`, plantilla y estilo; la opción `meekoIndentSections` (por defecto `false`) indenta un nivel el contenido de todas las secciones, y `meekoPreserveArrayBreaks` (por defecto `true`) deja expandido, en todo el JavaScript y TypeScript que formatee Prettier, un array con un salto de línea tras `[`, como `objectWrap: "preserve"` con los objetos. El servidor de lenguaje usa el mismo plugin, así que el editor y la CI coinciden (véase [editores](editors.md#formato-con-prettier)).

## Compatibilidad y límites
- Node.js 24 o posterior y TypeScript 7.0.2 para la CLI, el build, Vite y el servidor de lenguaje. Los entornos de ejecución y navegadores admitidos se listan en la [política de estabilidad](stability.md#entornos-soportados).
- La API pública sigue SemVer durante la serie 1.x: los cambios incompatibles requieren una versión major y las deprecaciones se anuncian en un minor (véase la [política de estabilidad](stability.md)). El paquete se distribuye como `@meekojs/meeko` bajo licencia MIT.
- El parser acepta el subconjunto de TypeScript y HTML descrito arriba; informa las construcciones no soportadas mediante diagnósticos.
- La hidratación requiere que el servidor y el navegador obtengan los mismos valores iniciales y el mismo orden de listas.
- No se ofrecen garantías de compatibilidad con plugins de Vue. El streaming SSR (`render: "stream"` con `defer` de `@meekojs/meeko/framework`) se describe en [framework.md](framework.md).

## Verificación del paquete

`pnpm run package:smoke` instala el tarball en un consumidor fuera del monorepo y comprueba CLI, SSR, tipos y Vite. `tests/package-boundaries.test.ts` fija la lista exacta de exports de la raíz. La extensión de VS Code se empaqueta y prueba en un host aislado con un proyecto consumidor externo. Los pasos de cada publicación están en [releasing.md](releasing.md).

## Enlaces a secciones anteriores

Los enlaces existentes a fragmentos de esta página siguen aquí y llevan a su nueva ubicación.
- <a id="componentes-meeko"></a>[Componentes .meeko](component-basics.md#componentes-meeko)
- <a id="desestructuración-en-el-script"></a>[Desestructuración en el script](component-basics.md#desestructuración-en-el-script)
- <a id="props-reactivas"></a>[Props reactivas](component-basics.md#props-reactivas)
- <a id="valores-por-defecto-en-defineprops"></a>[Valores por defecto en defineProps](component-basics.md#valores-por-defecto-en-defineprops)
- <a id="constantes-en-los-valores-por-defecto"></a>[Constantes en los valores por defecto](component-basics.md#constantes-en-los-valores-por-defecto)
- <a id="desestructurar-las-props"></a>[Desestructurar las props](component-basics.md#desestructurar-las-props)
- <a id="condiciones-con-ifwhen-y-tipos"></a>[Condiciones con if:when y tipos](component-template.md#condiciones-con-ifwhen-y-tipos)
- <a id="controles-de-formulario-con-model"></a>[Controles de formulario con model](component-template.md#controles-de-formulario-con-model)
- <a id="select-con-contenido-rico"></a>[<select> con contenido rico](component-template.md#select-con-contenido-rico)
- <a id="html-sin-escapar-con-html"></a>[HTML sin escapar con html](component-template.md#html-sin-escapar-con-html)
- <a id="html-de-confianza-trustedhtml-y-trusthtml"></a>[HTML de confianza: TrustedHtml y trustHtml](component-template.md#html-de-confianza-trustedhtml-y-trusthtml)
- <a id="html-que-viaja-una-vez-documenthtml"></a>[HTML que viaja una vez: documentHtml](component-template.md#html-que-viaja-una-vez-documenthtml)
- <a id="listas-con-y-sin-eachkey"></a>[Listas con y sin each:key](component-template.md#listas-con-y-sin-eachkey)
- <a id="estilos-del-componente-style-y-style-scoped"></a>[Estilos del componente: <style> y <style scoped>](component-styles.md#estilos-del-componente-style-y-style-scoped)
- <a id="estilos-con-ámbito-y-global"></a>[Estilos con ámbito y :global(...)](component-styles.md#estilos-con-ámbito-y-global)
- <a id="qué-elementos-reciben-el-atributo"></a>[Qué elementos reciben el atributo](component-styles.md#qué-elementos-reciben-el-atributo)
- <a id="elementos-sin-contenido-div-"></a>[Elementos sin contenido (<div />)](component-template.md#elementos-sin-contenido-div-)
- <a id="etiquetas-de-componente-appbutton-"></a>[Etiquetas de componente (<AppButton />)](component-dynamic.md#etiquetas-de-componente-appbutton-)
- <a id="etiquetas-html-en-component-is"></a>[Etiquetas HTML en <component is>](component-dynamic.md#etiquetas-html-en-component-is)
- <a id="nombres-de-componente-en-is"></a>[Nombres de componente en is](component-dynamic.md#nombres-de-componente-en-is)
- <a id="un-botón-que-es-ruta-enlace-o-botón"></a>[Un botón que es ruta, enlace o botón](component-dynamic.md#un-botón-que-es-ruta-enlace-o-botón)
- <a id="atributos-según-la-etiqueta"></a>[Atributos según la etiqueta](component-attributes.md#atributos-según-la-etiqueta)
- <a id="valores-de-los-atributos"></a>[Valores de los atributos](component-attributes.md#valores-de-los-atributos)
- <a id="class-y-style-junto-a-bindclass-y-bindstyle"></a>[class y style junto a bind:class y bind:style](component-attributes.md#class-y-style-junto-a-bindclass-y-bindstyle)
- <a id="atributos-en-bloque-con-bind"></a>[Atributos en bloque con bind](component-attributes.md#atributos-en-bloque-con-bind)
- <a id="props-estáticas"></a>[Props estáticas](component-attributes.md#props-estáticas)
- <a id="eventos-de-componente-defineemits-y-on"></a>[Eventos de componente: defineEmits y on:](component-events.md#eventos-de-componente-defineemits-y-on)
- <a id="modelos-de-componente-definemodel-y-model"></a>[Modelos de componente: defineModel y model](component-events.md#modelos-de-componente-definemodel-y-model)
- <a id="snippets-con-definesnippets"></a>[Snippets con defineSnippets](component-events.md#snippets-con-definesnippets)
- <a id="exponer-valores-defineexpose"></a>[Exponer valores: defineExpose](component-advanced.md#exponer-valores-defineexpose)
- <a id="referencias-a-elementos-ref-y-useelementref"></a>[Referencias a elementos: ref: y useElementRef](component-advanced.md#referencias-a-elementos-ref-y-useelementref)
- <a id="componentes-genéricos-generic"></a>[Componentes genéricos (generic)](component-advanced.md#componentes-genéricos-generic)
- <a id="composables-de-nivel-superior-y-await"></a>[Composables de nivel superior y await](component-advanced.md#composables-de-nivel-superior-y-await)
- <a id="módulo-generado"></a>[Módulo generado](component-advanced.md#módulo-generado)
- <a id="reactividad"></a>[Reactividad](language-reactivity.md#reactividad)
- <a id="ciclo-de-vida"></a>[Ciclo de vida](language-reactivity.md#ciclo-de-vida)
- <a id="ids-estables-useid"></a>[IDs estables: useId](language-reactivity.md#ids-estables-useid)
- <a id="componentes-integrados"></a>[Componentes integrados](component-builtins.md#componentes-integrados)
- <a id="popover-meekopopover"></a>[Popover: <MeekoPopover>](component-builtins.md#popover-meekopopover)
- <a id="select-meekoselect"></a>[Select: <MeekoSelect>](component-builtins.md#select-meekoselect)
- <a id="envolver-otro-componente"></a>[envolver otro componente](component-advanced.md#envolver-otro-componente)
