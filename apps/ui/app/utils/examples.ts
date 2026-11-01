/** Ejemplos copiables. Los controles de cada página ejercitan la misma API pública. */
export const examples = {
	container: `<UIContainer as="section" size="4k" gutter="md" ariaLabel="Proyectos">
  <h2>Proyectos del equipo</h2>
  <p>Contenido centrado, con espacio lateral adaptable.</p>
</UIContainer>`,
	containerNested: `<UIContainer size="4k">
  <header>Cabecera del espacio de trabajo</header>
  <UIContainer size="lg" gutter="none">
    <h1>Contenido de lectura</h1>
    <p>Un ancho menor dentro de una superficie amplia.</p>
  </UIContainer>
</UIContainer>`,
	containerCss: `.workspace {
  --meeko-ui-container-max-width: 110rem;
  --meeko-ui-container-gutter: clamp(1rem, 3vw, 5rem);
}`,
	install: 'pnpm add @meekojs/ui',
	config: `import { defineMeekoConfig } from '@meekojs/meeko/framework'
import ui from '@meekojs/ui'

export default defineMeekoConfig({
  modules: [ui],
  theme: { default: 'dark' },
})`,
	button: `<script lang="ts">
  const count = signal(0)
</script>

<template>
<UIButton on:click="() => count.value++">Guardar cambios</UIButton>
<UIButton variant="outline">Cancelar</UIButton>
<UIButton size="sm" disabled>No disponible</UIButton>
<p role="status">Cambios: {count.value}</p>
</template>`,
	buttonKinds: `<!-- Una ruta de la aplicación: navega sin recargar, con params y search tipados -->
<UIButton to="/links">Ver enlaces</UIButton>
<UIButton to="/users/[id]" bind:params="{ id: user.id }"
  bind:search="{ tab: 'actividad' }">Perfil</UIButton>

<!-- Cualquier URL: un <a>; con target="_blank" añade rel="noopener noreferrer" -->
<UIButton href="https://github.com/meekojs/meeko" target="_blank"
  variant="outline">GitHub</UIButton>
<UIButton href="/informe.pdf" download="informe.pdf">Descargar</UIButton>

<!-- Sin to ni href: un <button type="button"> -->
<UIButton type="submit" bind:disabled="saving.value">Guardar</UIButton>

<!-- id, title, aria-* y data-* llegan al elemento -->
<UIButton aria-describedby="hint" data-testid="reset" on:click="reset">Reiniciar</UIButton>`,
	card: `<script lang="ts">
  const count = signal(0)
</script>

<template>
<UICard title="Tu espacio de trabajo" variant="outline">
  <p role="status">Cambios guardados: {count.value}</p>
  <snippet name="footer">
    <UIButton on:click="() => count.value++">Guardar cambio</UIButton>
  </snippet>
</UICard>
</template>`,
	link: `<UILink to="/installation">Empezar</UILink>
<UILink to="/users/[id]" bind:params="{ id: user.id }">Perfil</UILink>
<UILink href="https://github.com/meekojs/meeko"
  target="_blank" variant="outline">GitHub</UILink>

<UILinkCard to="/theming" title="Personalización"
  description="Conecta los tokens con tu marca." />`,
	badge: `<UIBadge>Información</UIBadge>
<UIBadge tone="accent">Publicado</UIBadge>
<UIBadge tone="danger">Revisar</UIBadge>`,
	form: `<script lang="ts">
  const name = signal('')
  const error = signal<string | undefined>(undefined)
  function save() {
    error.value = name.value.trim() ? undefined : 'Escribe un nombre.'
  }
</script>

<template>
  <UIField id="name" label="Nombre" bind:error="error.value" required>
    <snippet name="default" params="id, describedBy">
      <UIInput bind:id="id" bind:describedBy="describedBy"
        model="name" bind:invalid="Boolean(error.value)" required />
    </snippet>
  </UIField>
  <UIButton on:click="save">Guardar</UIButton>
</template>`,
	table: `<script lang="ts">
  import type { TableColumn } from '@meekojs/ui/runtime'

  interface Project { id: number; name: string; status: string }
  const columns = [
    { key: 'name', label: 'Proyecto' },
    { key: 'status', label: 'Estado', format: value => value.toUpperCase() },
  ] satisfies TableColumn<Project>[]
  const rows = signal<Project[]>([
    { id: 1, name: 'Sitio principal', status: 'Publicado' },
  ])
</script>

<template>
  <UITable bind:columns="columns" bind:rows="rows.value"
    rowKey="id" caption="Proyectos del equipo" />
</template>`,
	tableColumnSnippets: `<UITable bind:columns="columns" bind:rows="rows.value" rowKey="id">
  <!-- value es string: el tipo de Project['status']. -->
  <snippet name="cell-status" params="row, value">
    <UIBadge bind:tone="value === 'Publicado' ? 'accent' : 'neutral'">{value}</UIBadge>
  </snippet>
  <snippet name="header-name" params="column">
    <abbr title="Nombre del proyecto">{column.label}</abbr>
  </snippet>
  <!-- name="cell-email" no compila: Project no tiene email. -->
</UITable>`,
	select: `<script lang="ts">
  const plans = ['Personal', 'Equipo', 'Empresa', 'Educación']
  const topics = ['Accesibilidad', 'Diseño', 'Documentación', 'Rendimiento']
  const plan = signal<string | null>(null)
  const chosen = signal<string[]>([])
</script>

<template>
  <form method="post" action="/subscriptions">
    <label for="plan">Plan</label>
    <UISelect id="plan" model="plan" bind:options="plans"
      name="plan" placeholder="Elige un plan" required />

    <label for="topics">Temas</label>
    <UISelect id="topics" model="chosen" bind:options="topics"
      name="topics" multiple searchable bind:max="2" />

    <UIButton type="submit">Enviar selección</UIButton>
  </form>
</template>`,
	selectObjects: `<script lang="ts">
  interface Member { id: number; name: string; team: string; role: string; disabled?: boolean }
  const members: Member[] = [
    { id: 1, name: 'Lucía Martín', team: 'Diseño', role: 'Directora de arte' },
    { id: 4, name: 'Mateo Gil', team: 'Ingeniería', role: 'De vacaciones', disabled: true },
  ]
  const owner = signal<Member | null>(null)
</script>

<template>
  <UISelect model="owner" bind:options="members" by="id"
    labelBy="name" groupBy="team" label="Responsable" clearable>
    <snippet name="option" params="member, state">
      <strong>{member.name}</strong>
      <small>{state.disabled ? 'No disponible' : member.role}</small>
    </snippet>
  </UISelect>
</template>`,
	popoverMenu: `<script lang="ts">
  const action = signal('')
</script>

<template>
  <UIPopover role="menu" placement="bottom-start" bind:offset="6">
    <snippet name="trigger">Acciones del proyecto</snippet>
    <button role="menuitem" on:click="() => (action.value = 'renombrar')">Renombrar</button>
    <button role="menuitem" on:click="() => (action.value = 'duplicar')">Duplicar</button>
    <button role="menuitem" on:click="() => (action.value = 'archivar')">Archivar</button>
  </UIPopover>
</template>`,
	popoverDialog: `<script lang="ts">
  const opened = signal(false)
</script>

<template>
  <UIPopover role="dialog" label="Filtrar proyectos" model="opened">
    <snippet name="trigger">Filtrar</snippet>
    <label><input type="checkbox"> Publicados</label>
    <UIButton on:click="() => (opened.value = false)">Aplicar filtros</UIButton>
  </UIPopover>
</template>`,
	popoverTooltip: `<UIPopover mode="hint" placement="top" bind:delay="300">
  <snippet name="trigger">Estado: borrador</snippet>
  Sólo tu equipo puede verlo hasta que lo publiques.
</UIPopover>`,
	popoverAnchor: `<UIPopover role="menu">
  <snippet name="anchor" params="trigger">
    <button type="button" class="avatar" bind="trigger">
      <img src="/avatar.png" alt="Mi cuenta">
    </button>
  </snippet>
  <button role="menuitem">Perfil</button>
  <button role="menuitem">Cerrar sesión</button>
</UIPopover>`,
	themeToggle: `// meeko.config.ts
export default defineMeekoConfig({
  modules: [ui],
  theme: { default: 'dark' },
})

<!-- app/app.meeko -->
<UIThemeToggle />`,
	themeToggleSelect: `<UIThemeToggle mode="select" />`,
	themeToggleCustom: `<UIThemeToggle
  bind:themes="['light', 'dark']"
  bind:labels="{ light: 'Light', dark: 'Dark' }"
  bind:messages="{
    group: 'Theme',
    unknown: 'Change theme',
    cycle: (current, next) => 'Theme: ' + current + '. Switch to ' + next,
  }">
  <snippet name="light"><svg aria-hidden="true">…</svg></snippet>
  <snippet name="dark"><svg aria-hidden="true">…</svg></snippet>
</UIThemeToggle>`,
	modal: `<script lang="ts">
  const opened = signal(false)
</script>

<template>
  <UIButton on:click="() => (opened.value = true)">Abrir</UIButton>
  <UIModal title="Editar proyecto" model="opened" size="md">
    <p>Contenido del diálogo.</p>
    <snippet name="footer">
      <UIButton on:click="() => (opened.value = false)">Listo</UIButton>
    </snippet>
  </UIModal>
</template>`,
	modalOpen: `const modal = useModal()

// Invoca esta función desde una acción del usuario.
async function confirm() {
  const accepted = await modal.open<boolean>('ModalConfirm', {
    message: '¿Quieres confirmar esta acción?',
  })
  // boolean | undefined: descartar devuelve undefined.
  return accepted
}`,
	modalInstance: `<!-- app/components/Modal/Confirm.meeko -->
<script lang="ts">
  const props = defineProps<{ message: string }>()

  const modal = useModalInstance<boolean>()
</script>

<template>
  <UIModal title="Confirmar" bind:description="props.message">
    <snippet name="footer">
      <UIButton variant="outline" on:click="() => modal.dismiss()">Cancelar</UIButton>
      <UIButton on:click="() => modal.close(true)">Confirmar</UIButton>
    </snippet>
  </UIModal>
</template>`,
	app: `<!-- app/app.meeko -->
<template>
  <UIApp>
    <MeekoOutlet />
  </UIApp>
</template>`,
	theme: `import { defineMeekoConfig } from '@meekojs/meeko/framework'
import ui from '@meekojs/ui'

export default defineMeekoConfig({
  modules: [ui],
  theme: { default: 'dark' },
  ui: {
    tokens: {
      primary: 'var(--brand-action)',
      primaryHover: 'var(--brand-action-hover)',
      onPrimary: 'var(--brand-on-action)',
      accent: 'var(--brand-accent)',
      focus: 'var(--brand-accent)',
      surface: 'var(--brand-surface)',
      text: 'var(--brand-text)',
      border: 'var(--brand-border)',
    },
    defaults: {
      button: { shape: 'pill', size: 'md' },
      link: { variant: 'outline' },
      card: { variant: 'soft' },
    },
  },
})`,
	messages: `// meeko.config.ts
export default defineMeekoConfig({
  modules: ['@meekojs/ui'],
  ui: {
    // Sin @meekojs/i18n, el idioma de los textos; con él, el respaldo de un idioma sin textos.
    locale: 'en',
    messages: {
      en: { table: { empty: 'Nothing here yet.' } },
      fr: {
        modal: { close: 'Fermer' },
        table: { empty: 'Aucune donnée.' },
        select: { empty: 'Aucun résultat', clear: 'Effacer la sélection' },
        themeToggle: {
          labels: { light: 'Clair', dark: 'Sombre', system: 'Système' },
          unknown: 'Changer de thème',
          group: 'Thème',
          cycle: 'Thème : {current}. Passer à {next}',
        },
      },
    },
  },
})`,
	themeCss: `/* app/styles/main.css */
:root {
  --brand-action: #eef0f3;
  --brand-action-hover: #ffffff;
  --brand-on-action: #0a0b0d;
  --brand-accent: #8fb4ff;
  --brand-surface: #101115;
  --brand-text: #eef0f3;
  --brand-border: rgb(255 255 255 / 0.14);
}
:root[data-theme='light'] {
  --brand-action: #0d0e10;
  --brand-action-hover: #26292f;
  --brand-on-action: #fbfbfc;
  --brand-accent: #2f63d6;
  --brand-surface: #f4f5f7;
  --brand-text: #0d0e10;
  --brand-border: rgb(0 0 0 / 0.14);
}`,
	transitions: `// meeko.config.ts
export default defineMeekoConfig({ viewTransitions: true })

/* app/styles/main.css: un único elemento por nombre y vista */
.project-card { view-transition-name: project; }

<!-- Enlace con navegación normal si prefieres omitir la transición -->
<MeekoLink to="/transitions/project"
  data-meeko-view-transition="false">Abrir sin transición</MeekoLink>`,
	icon: `<p><UIIcon name="lucide:search" /> Buscar en el proyecto</p>
<UIButton variant="outline">
  <UIIcon name="lucide:trash-2" label="Eliminar" />
</UIButton>`,
	iconConfig: `// pnpm add @meekojs/icon && pnpm add -D @iconify-json/lucide
// meeko.config.ts
export default defineMeekoConfig({
  modules: ['@meekojs/icon'],
  icon: {
    collections: ['lucide'], // @iconify-json/lucide del proyecto
    local: 'app/icons', // SVG propios: 'local:<nombre>'
    size: '1em',
    include: ['lucide:sun', 'lucide:moon'], // para bind:name
  },
})`,
	iconDynamic: `<!-- Literales de la expresión: se resuelven al compilar -->
<UIIcon
  bind:name="open.value ? 'lucide:x' : 'lucide:menu'"
  bind:label="open.value ? 'Cerrar menú' : 'Abrir menú'" />

<!-- Un valor que llega de datos: el icono debe estar en icon.include -->
<UIIcon bind:name="mode.value" />`,
	iconLocal: `<!-- app/icons/paw.svg -->
<UIIcon name="local:paw" label="Meeko" size="1.5em" />`,
} as const
