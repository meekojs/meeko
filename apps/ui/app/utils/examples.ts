/** Ejemplos copiables. Los controles de cada página ejercitan la misma API pública. */
export const examples = {
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
	link: `<UILink href="/installation">Empezar</UILink>
<UILink href="https://github.com/meekojs/meeko"
  target="_blank" variant="outline">GitHub</UILink>

<UILinkCard href="/theming" title="Personalización"
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
} as const
