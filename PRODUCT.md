# Producto Meeko

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Desarrolladores que escriben componentes `.meeko` con TypeScript y necesitan probar SSR, hidratación y reactividad durante el desarrollo local.

## Product Purpose

Meeko es un motor experimental de componentes tipados, con SSR desde el inicio. Compila archivos `.meeko` y actualiza el DOM mediante señales. DevTools permite examinar y depurar cada instancia de componente mientras se desarrolla una aplicación.

## Operating Context

El paquete público es `@meekojs/meeko`. El proyecto usa TypeScript 7, ofrece un plugin de Vite y una extensión local para VS Code. El usuario pidió que DevTools funcione tanto dentro de la página como en un panel de Chrome DevTools.

## Capabilities and Constraints

- Los componentes combinan script TypeScript, plantilla y estilos opcionales.
- El motor ofrece renderizado en servidor, hidratación, composición y señales reactivas.
- DevTools debe identificar instancias individuales, mostrar props y señales, y permitir pausar cuando cambie una señal de la instancia seleccionada.
- La instrumentación de DevTools pertenece al modo de desarrollo; el renderizado de producción no debe incluirla.
- La primera versión pública del motor es experimental (`0.0.1`). La API puede evolucionar durante la serie `0.x`.

## Brand Commitments

El nombre y el logo de Meeko están dedicados a la gatita del autor. El recurso versionado es `assets/brand/meeko-logo.png`.

## Product Principles

- Una instancia debe poder identificarse y liberarse sin ambigüedad.
- Las herramientas muestran el estado real del runtime y explican sus límites.
- La observación de desarrollo no cambia el resultado de SSR ni el comportamiento de producción.
