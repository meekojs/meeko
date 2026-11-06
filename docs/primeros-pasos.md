# Tu primera aplicación

Vas a convertir el starter en una lista de tareas con un filtro y una segunda página. La lista aparece en el HTML inicial; el botón se activa al hidratarse en el navegador. No necesitas una base de datos.

## Crear y abrir el proyecto

Necesitas Node.js 24 o posterior y pnpm 12 para descargar la CLI. En la carpeta donde quieras crear `my-app`:

```powershell
npm exec --yes --package=@meekojs/meeko@1.9.0 -- meeko init-framework my-app
cd my-app
npm install
npm run dev
```

Abre `http://localhost:4173`. Verás el contador del starter. Si ya seguiste el [Inicio rápido](inicio-rapido.md), conserva ese mismo proyecto y continúa desde aquí.

## Sustituir la página inicial

**Archivo: `my-app/app/pages/index.meeko`.** Sustituye todo su contenido por este componente:

```meeko
<script server lang="ts">
export const route = definePage({ render: "prerender" });
</script>

<script lang="ts">
import { signal } from "@meekojs/meeko";

const tasks = [
  { id: 1, title: "Crear una página", done: true },
  { id: 2, title: "Probar el filtro", done: false },
  { id: 3, title: "Añadir otra ruta", done: false },
];
const onlyPending = signal(false);
</script>

<template>
  <main>
    <h1>Mis tareas</h1>
    <p>Una lista pequeña para empezar con Meeko.</p>
    <button type="button" on:click="() => onlyPending.value = !onlyPending.value">
      {onlyPending.value ? "Mostrar todas" : "Mostrar pendientes"}
    </button>
    <ul>
      <li
        each:of="onlyPending.value ? tasks.filter((task) => !task.done) : tasks"
        each:as="task"
        each:key="task.id"
      >
        {task.title}{task.done ? " ✓" : ""}
      </li>
    </ul>
    <a href="/acerca">Acerca de esta lista</a>
  </main>
</template>
```

Guarda el archivo. Verás tres tareas. Al pulsar «Mostrar pendientes» sólo quedarán dos. `render: "prerender"` genera el HTML inicial durante el build; el navegador hidrata el botón y `signal` actualiza la lista. En el framework `definePage` está disponible en el bloque `server`; `signal` se importa explícitamente del motor.

## Añadir una ruta

**Archivo nuevo: `my-app/app/pages/acerca.meeko`.** Crea el archivo con este contenido:

```meeko
<script server lang="ts">
export const route = definePage({ render: "prerender" });
</script>

<template>
  <main>
    <h1>Acerca de esta lista</h1>
    <p>Mi primera aplicación Meeko tiene dos páginas.</p>
    <a href="/">Volver a mis tareas</a>
  </main>
</template>
```

Abre `http://localhost:4173/acerca` o sigue el enlace desde la lista. Los archivos de `app/pages` definen rutas; aquí `<a>` basta para enlazar páginas. Consulta [navegación](routing-navigation.md) cuando necesites enlaces con estado activo o navegación programática.

## Comprobar el resultado

Detén `npm run dev` con Ctrl+C. Desde `my-app`:

```powershell
npm run check
npm run build
```

`check` comprueba los tipos y `build` genera las páginas. Si el editor señala un error, revisa que cada archivo esté en `app/pages`, que el import de `signal` esté en el bloque de cliente y que Node sea 24 o posterior.

Continúa con [Cargar datos de una ruta](routing-data.md) para sustituir la lista fija por datos del servidor. La [guía de componentes](api.md) explica props, composición y estilos cuando quieras extraer la lista a `app/components`.
