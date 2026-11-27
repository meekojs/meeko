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
  --ui-container-max-width: 110rem;
  --ui-container-gutter: clamp(1rem, 3vw, 5rem);
}`,
	install: 'pnpm add @meekojs/ui tailwindcss',
	styles: `@import 'tailwindcss';
@import '@meekojs/ui';`,
	stylesWithoutPreflight: `/* Tailwind sin su preflight: su tema y sus utilidades, en sus capas */
@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
@import '@meekojs/ui';`,
	hues: `@import 'tailwindcss';
@import '@meekojs/ui';
@import '@meekojs/ui/hues';`,
	config: `import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
  modules: ['@meekojs/ui'],
  theme: { default: 'dark' },
})`,
	button: `<script lang="ts">
  const count = signal(0)
</script>

<template>
<UIButton on:click="() => count.value++">Guardar cambios</UIButton>
<UIButton variant="outline" color="neutral">Cancelar</UIButton>
<UIButton size="sm" disabled>No disponible</UIButton>
<p role="status">Cambios: {count.value}</p>
</template>`,
	buttonAppearance: `<UIButton variant="solid" color="primary" size="lg" radius="full" elevation="sm">Guardar</UIButton>
<UIButton variant="soft" color="success" size="sm">Publicar</UIButton>
<UIButton variant="outline" color="info">outline</UIButton>
<UIButton variant="ghost" color="primary">ghost</UIButton>
<UIButton variant="link" color="primary">link</UIButton>`,
	badgeAppearance: `<UIBadge variant="solid" color="info" radius="sm">Publicado</UIBadge>
<UIBadge
	dot
	variant="outline"
	color="warning"
	radius="full"
>
	Pendiente
</UIBadge>
<UIBadge variant="soft" color="success">soft</UIBadge>
<UIBadge variant="surface" color="info">surface</UIBadge>`,
	inputAppearance: `<label for="appearance-email">Correo de trabajo</label>
<UIInput
	id="appearance-email"
	type="email"
	placeholder="name@example.com"
	variant="surface"
	color="primary"
	size="lg"
	radius="lg"
/>
<label for="appearance-input-outline">outline</label>
<UIInput
	id="appearance-input-outline"
	variant="outline"
	color="primary"
/>
<label for="appearance-input-ghost">ghost</label>
<UIInput
	id="appearance-input-ghost"
	variant="ghost"
	color="primary"
/>
<label for="appearance-input-soft">soft</label>
<UIInput
	id="appearance-input-soft"
	variant="soft"
	color="primary"
/>`,
	cardTheme: `<UICard
	title="Resumen semanal"
	color="primary"
	radius="xl"
	elevation="md"
>
	3 proyectos actualizados
</UICard>
<UICard
	title="outline"
	variant="outline"
	color="primary"
>
	3 proyectos actualizados
</UICard>
<UICard
	title="glass"
	variant="glass"
	color="primary"
>
	3 proyectos actualizados
</UICard>
<UICard
	title="plain"
	variant="plain"
	color="primary"
>
	3 proyectos actualizados
</UICard>`,
	buttonKinds: `<!-- Una ruta de la aplicación: navega sin recargar, con params y search tipados -->
<UIButton to="/links">Ver enlaces</UIButton>
<UIButton to="/users/[id]" bind:params="{ id: user.id }"
  bind:search="{ tab: 'actividad' }">Perfil</UIButton>

<!-- Cualquier URL: un <a>; con target="_blank" añade rel="noopener noreferrer" -->
<UIButton href="https://github.com/meekojs/meeko" target="_blank"
  variant="outline"
  color="neutral">GitHub</UIButton>
<UIButton href="/informe.pdf" download="informe.pdf">Descargar</UIButton>

<!-- Sin to ni href: un <button type="button"> -->
<UIButton type="submit" bind:disabled="saving.value">Guardar</UIButton>

<!-- id, title, aria-* y data-* llegan al elemento -->
<UIButton aria-describedby="hint" data-testid="reset" on:click="reset">Reiniciar</UIButton>`,
	card: `<script lang="ts">
  const count = signal(0)
</script>

<template>
<UICard title="Tu espacio de trabajo">
  <p role="status">Cambios guardados: {count.value}</p>
  <snippet name="footer">
    <UIButton on:click="() => count.value++">Guardar cambio</UIButton>
  </snippet>
</UICard>
</template>`,
	link: `<UILink to="/installation">Empezar</UILink>
<UILink to="/users/[id]" bind:params="{ id: user.id }">Perfil</UILink>
<UILink href="https://github.com/meekojs/meeko"
  target="_blank" variant="outline" color="neutral">GitHub</UILink>

<UILinkCard to="/theming" title="Personalización"
  description="Conecta los tokens con tu marca." />`,
	badge: `<UIBadge>Información</UIBadge>
<UIBadge color="primary">Publicado</UIBadge>
<UIBadge color="danger">Revisar</UIBadge>`,
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
    <UIBadge bind:color="value === 'Publicado' ? 'primary' : 'neutral'">{value}</UIBadge>
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
    <UICombobox id="topics" model="chosen" bind:options="topics"
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
    <UIButton variant="ghost" color="neutral" role="menuitem" on:click="() => (action.value = 'renombrar')">Renombrar</UIButton>
    <UIButton variant="ghost" color="neutral" role="menuitem" on:click="() => (action.value = 'duplicar')">Duplicar</UIButton>
    <UIButton variant="ghost" color="neutral" role="menuitem" on:click="() => (action.value = 'archivar')">Archivar</UIButton>
  </UIPopover>
</template>`,
	popoverDialog: `<script lang="ts">
  const opened = signal(false)
</script>

<template>
  <UIPopover role="dialog" label="Filtrar proyectos" model="opened">
    <snippet name="trigger">Filtrar</snippet>
    <UICheckbox label="Publicados" model="published" />
    <UIButton on:click="() => (opened.value = false)">Aplicar filtros</UIButton>
  </UIPopover>
</template>`,
	popoverTooltip: `<UITooltip bind:offset="6">
  <snippet name="trigger">Estado: borrador</snippet>
  Sólo tu equipo puede verlo hasta que lo publiques.
</UITooltip>`,
	popoverAnchor: `<UIPopover role="menu">
  <snippet name="anchor" params="trigger">
    <button type="button" class="avatar" bind="trigger">
      <img src="/avatar.png" alt="Mi cuenta">
    </button>
  </snippet>
  <button role="menuitem">Perfil</button>
  <button role="menuitem">Cerrar sesión</button>
</UIPopover>`,
	menu: `<script lang="ts">
  import type { UIMenuEntry } from '@meekojs/ui/runtime'

  const items: UIMenuEntry[] = [
    { label: 'Renombrar', shortcut: 'F2', onSelect: () => rename() },
    { label: 'Duplicar', onSelect: () => duplicate() },
    { label: 'Ver en Popover', to: '/popover' },
    { label: 'Archivar', disabled: true },
    { separator: true },
    { label: 'Eliminar', color: 'danger', onSelect: () => remove() },
  ]
</script>

<template>
  <UIMenu triggerLabel="Acciones del proyecto" bind:items="items" on:select="(item) => console.log(item.label)" />
</template>`,
	menuRow: `<UITable caption="Archivos" bind:hideCaption="true" rowKey="id" bind:rows="files" bind:columns="columns">
  <snippet name="cell-actions" params="file">
    <UIMenu bind:ariaLabel="'Acciones de ' + file.name" size="sm" placement="bottom-end" bind:items="actionsOf(file)" />
  </snippet>
</UITable>`,
	menuSnippets: `<UIMenu label="Cuenta" bind:items="[{ label: 'Perfil', to: '/profile' }, { label: 'Salir', onSelect: logout }]">
  <snippet name="trigger"><img src="/me.png" alt="Mi cuenta" width="24" height="24" /></snippet>
  <snippet name="item" params="item"><strong>{item.label}</strong></snippet>
  <button type="button" role="menuitem" on:click="openHelp">Ayuda</button>
</UIMenu>`,
	themeToggle: `// meeko.config.ts
export default defineMeekoConfig({
  modules: ['@meekojs/ui'],
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
      <UIButton variant="outline" color="neutral" on:click="() => modal.dismiss()">Cancelar</UIButton>
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

export default defineMeekoConfig({
  modules: ['@meekojs/ui'],
  theme: { default: 'dark' },
  ui: {
    // Cada clave asigna tokens --ui-*; una referencia var() sigue los temas de tu web.
    tokens: {
      primary: 'var(--brand-action)',
      primaryHover: 'var(--brand-action-hover)',
      onPrimary: 'var(--brand-on-action)',
      focus: 'var(--brand-focus)',
      surface: 'var(--brand-surface)',
      text: 'var(--brand-text)',
      border: 'var(--brand-border)',
    },
    defaults: {
      button: { radius: 'full', size: 'md' },
      link: { variant: 'outline', color: 'neutral' },
      card: { variant: 'soft' },
    },
  },
})`,
	themeDefaults: `export default defineMeekoConfig({
  modules: ['@meekojs/ui'],
  ui: {
    defaults: {
      card: { padding: 'sm', ui: { header: 'panel-card-header' } },
      table: { density: 'compact', class: 'panel-table' },
      stat: { ui: { value: 'panel-stat-value' } },
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
	themeCss: `/* app/styles/main.css: tu marca, sobre los pasos de cada escala */
:root {
  --ui-color-primary-9: #0a7cff;
  --ui-color-primary-10: #0067d6;
  --ui-radius-md: 0.5rem;
}
:root[data-theme='dark'] {
  --ui-color-primary-9: #3b96ff;
  --ui-color-primary-10: #66adff;
}`,
	themeColor: `/* app/styles/main.css: primary pasa a leer la escala crimson */
@import 'tailwindcss';
@import '@meekojs/ui';
@import '@meekojs/ui/hues';

/* Con [data-theme] gana también a los pasos del tema oscuro de UI */
:root,
:root[data-theme] {
  --ui-color-primary-1: var(--color-crimson-1);
  --ui-color-primary-2: var(--color-crimson-2);
  --ui-color-primary-3: var(--color-crimson-3);
  --ui-color-primary-4: var(--color-crimson-4);
  --ui-color-primary-5: var(--color-crimson-5);
  --ui-color-primary-6: var(--color-crimson-6);
  --ui-color-primary-7: var(--color-crimson-7);
  --ui-color-primary-8: var(--color-crimson-8);
  --ui-color-primary-9: var(--color-crimson-9);
  --ui-color-primary-10: var(--color-crimson-10);
  --ui-color-primary-11: var(--color-crimson-11);
  --ui-color-primary-12: var(--color-crimson-12);
  --ui-color-primary-contrast: var(--color-crimson-contrast);
}`,
	themeUse: `.release-note {
  border: var(--ui-border-width) solid var(--ui-color-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-color-surface);
  padding: var(--ui-space-4);
  color: var(--ui-color-text-soft);
  font-size: var(--ui-font-size-md);
}`,
	themeSlots: `<!-- class llega a la raíz; ui, a cada parte por el nombre de su slot -->
<UICard title="Plan Pro" class="pricing-card"
  bind:ui="{ header: 'pricing-header', title: 'pricing-title' }">
  <p>Todo lo del plan básico, sin límites.</p>
</UICard>
<UIBadge color="success" dot bind:ui="{ dot: 'pulse' }">Publicado</UIBadge>`,
	themeSlotsCss: `/* app/styles/main.css: sin @layer, gana a las clases del componente */
.pricing-card {
  border-color: var(--ui-color-primary-border);
}
.pricing-title {
  color: var(--ui-color-primary-text);
}`,
	buttonStates: `<UIButton color="danger">Eliminar</UIButton>
<UIButton color="danger" variant="outline">Revocar</UIButton>
<UIButton bind:loading="saving.value">Guardar</UIButton>
<UIButton iconOnly ariaLabel="Eliminar" variant="outline" color="neutral">
  <UIIcon name="lucide:trash-2" />
</UIButton>`,
	iconButton: `<UIIconButton label="Abrir el menú" icon="menu" />
<UIIconButton label="Cerrar" icon="close" variant="outline" />
<UIIconButton label="Confirmar" icon="check" variant="solid" color="primary" on:click="confirm" />
<UIIconButton label="Ver enlaces" icon="arrowEnd" to="/links" />
<UIIconButton label="Eliminar">
  <UIIcon name="lucide:trash-2" />
</UIIconButton>`,
	iconButtonStates: `<UIIconButton label="Fijar el panel" icon="check" variant="outline"
  bind:pressed="pinned.value" on:click="() => (pinned.value = !pinned.value)" />
<UIIconButton label="Borrar" icon="close" color="danger" />
<UIIconButton label="Guardando" icon="check" bind:loading="saving.value" />
<UIIconButton label="Pequeño" icon="menu" size="sm" />
<UIIconButton label="Sin tooltip" icon="menu" bind:tooltip="false" />`,
	copyButton: `<script lang="ts">
  const copies = signal(0)
</script>

<template>
<UICopyButton value="pnpm add @meekojs/ui" on:copy="() => copies.value++" />
<UICopyButton value="https://ui.meekojs.com" label="Copiar enlace" variant="outline" size="sm" />
<UICopyButton value="sk_test_4f8a" iconOnly label="Copiar el token"
  on:copyError="(error) => console.warn(error)" />
</template>`,
	copyButtonTokens: `/* Los colores del resultado, sólo donde el texto no va sobre un sólido */
.billing {
  --ui-copy-button-copied-color: var(--ui-color-info-text);
  --ui-copy-button-failed-color: var(--ui-color-warning-text);
}`,
	modalConfirm: `const modal = useModal()

async function remove() {
  const confirmed = await modal.confirm({
    title: '¿Eliminar el proyecto?',
    description: 'Se borran sus archivos y no se puede deshacer.',
    confirmLabel: 'Eliminar',
    color: 'danger',
  })
  if (confirmed) await deleteProject()
}`,
	nativeElements: `<progress value="0.6" aria-label="Subida"></progress>
<progress aria-label="Cargando"></progress>

<meter min="0" max="100" low="25" high="75" optimum="100" value="90">90 %</meter>
<meter min="0" max="100" low="25" high="75" optimum="100" value="50">50 %</meter>
<meter min="0" max="100" low="25" high="75" optimum="100" value="10">10 %</meter>

<input type="file" accept="image/*" multiple aria-label="Fotos" />`,
	nativeElementsTokens: `:root {
  --ui-progress-height: 0.25rem;
  --ui-progress-color: var(--ui-color-success);
  --ui-meter-suboptimum-color: var(--ui-color-orange-9);
  --ui-file-button-bg: var(--ui-color-primary-soft);
}`,
	navigationProgress: `/* Más gruesa, de otro color y más paciente */
:root {
  --ui-navigation-progress-height: 0.1875rem;
  --ui-navigation-progress-color: var(--ui-color-info);
  --ui-navigation-progress-delay: 250ms;
}

/* Sin barra */
:root {
  --ui-navigation-progress-height: 0;
}`,
	textarea: `<UIField id="comment" label="Comentario" bind:counter="comment.value.length + '/200'">
  <snippet name="default" params="id, describedBy">
    <UITextarea model="comment" bind:id="id" bind:describedBy="describedBy"
      name="comment" bind:rows="4" bind:maxlength="200" />
  </snippet>
</UIField>`,
	checkbox: `<UICheckbox model="accepted" label="Acepto las condiciones"
  description="Puedes retirarlo más tarde." name="accepted" value="yes" required />
<UISwitch model="notifications" label="Notificaciones" name="notifications" />`,
	radio: `<script lang="ts">
  const period = signal('week')
  const periods = [
    { value: 'day', label: 'Día' },
    { value: 'week', label: 'Semana' },
    { value: 'year', label: 'Año', disabled: true },
  ]
</script>

<template>
  <UIRadioGroup model="period" legend="Periodo" name="period" bind:options="periods" />
  <UIRadioGroup model="period" legend="Periodo" layout="segmented" bind:options="periods" />
</template>`,
	segmented: `<script lang="ts">
  const days = signal('30')
  const options = [
    { value: '7', label: '7 días' },
    { value: '30', label: '30 días' },
    { value: '90', label: '90 días' },
  ]
</script>

<template>
  <form method="get">
    <UISegmentedControl legend="Periodo del gráfico" hideLegend size="sm" name="days" model="days" bind:options="options" />
  </form>
</template>`,
	dateRange: `<script lang="ts">
  import type { UIDateRangeValue } from '@meekojs/ui/runtime'

  const from = signal('')
  const to = signal('')
  // «Hoy» del servidor: los atajos salen activos en el HTML y coinciden al hidratar.
  const today = '2026-11-24'
  function load(range: UIDateRangeValue) {
    // Sólo llega un rango completo y válido.
  }
</script>

<template>
  <UIDateRange label="Periodo" model:from="from" model:to="to"
    fromName="desde" toName="hasta" bind:today="today"
    min="2020-01-01" bind:max="today" bind:maxDays="366" on:change="load" />
</template>`,
	dateRangeField: `<UIField id="period" label="Periodo de ventas" hint="Hasta 366 días">
  <snippet name="default" params="id, describedBy">
    <UIDateRange bind:id="id" bind:describedBy="describedBy"
      model:from="from" model:to="to" bind:maxDays="366" bind:presets="[]" />
  </snippet>
</UIField>`,
	slider: `<UISlider model="volume" label="Volumen" name="volume" bind:min="0" bind:max="100" bind:step="5" />`,
	alert: `<UIAlert color="success" title="Cambios guardados" description="Ya están publicados." />
<UIAlert color="danger" title="No se pudo publicar" dismiss on:dismiss="clear">
  <p>La base de datos no responde.</p>
  <snippet name="actions"><UIButton size="sm" on:click="retry">Reintentar</UIButton></snippet>
</UIAlert>`,
	toast: `<script lang="ts">
  const toast = useToast()
</script>

<template>
  <UIButton on:click="() => toast.add({ text: 'Cambios guardados', color: 'success', duration: 5000 })">
    Guardar
  </UIButton>
</template>`,
	empty: `<UIEmpty layout="panel" title="Sin proyectos" description="Crea el primero para empezar.">
  <snippet name="actions"><UIButton>Crear proyecto</UIButton></snippet>
</UIEmpty>
<UISkeleton bind:lines="3" bind:widths="['full', 'long', 'short']" />`,
	stat: `<UIStat label="Visitas" bind:value="1280" detail="Últimos 7 días" />
<UIDescriptionList bind:columns="2" bind:items="[
  { label: 'Estado', value: 'Publicado', detail: 'Hoy' },
  { label: 'Autor', value: 'Equipo Meeko' },
]" />
<UIDisclosure summary="Detalles técnicos"><p>Se abre sin JavaScript.</p></UIDisclosure>`,
	kpi: `<!-- Una cifra clave: variación con su color, periodo, tendencia y enlace al detalle -->
<UIStat label="Ingresos" value="12 400 €" bind:change="12.5"
  period="frente a los 30 días anteriores"
  bind:trend="[8.2, 9.1, 8.7, 10.4, 11.2, 10.9, 12.4]" to="/ingresos" />

<!-- Bajar es bueno: un tiempo de respuesta que baja es de éxito -->
<UIStat label="Tiempo de respuesta" value="180 ms" bind:change="-8" good="down" />

<!-- Un texto ya formateado: su signo da la dirección -->
<UIStat label="Pedidos" bind:value="320" change="−8 pedidos" period="este mes" />

<!-- Un sparkline suelto, con área -->
<UISparkline bind:values="visits" area color="primary" />`,
	diff: `<UIDiff label="Cambios en la guía" bind:diff="patch" />`,
	diffSample: `--- a/guide.md
+++ b/guide.md
@@ -1,3 +1,3 @@
 # Guía
-Instala con npm.
+Instala con pnpm.
 Después, registra el módulo.`,
	codeBlock: `<UICodeBlock label="Terminal" code="pnpm add @meekojs/ui" />
<UICodeBlock verdict="good" verdictLabel="Bien" lang="ts" bind:code="good" />
<UICodeBlock mode="log" label="Registro" bind:code="log" />
<UIProse as="article" bind:html="doc.html" />`,
	page: `<UIPage layout="docs">
  <snippet name="header">
    <UIHeader bind:brand="brand" bind:items="items">
      <snippet name="actions"><UIThemeToggle /></snippet>
    </UIHeader>
  </snippet>
  <snippet name="bar">
    <UIDrawer title="Contenidos" triggerLabel="Contenidos">
      <UINavigationTree bind:groups="groups" />
    </UIDrawer>
  </snippet>
  <snippet name="sidebar"><UINavigationTree bind:groups="groups" /></snippet>
  <snippet name="aside"><UITableOfContents bind:entries="toc" /></snippet>
  <UIPageHeader title="Instalación" description="Añade el paquete a tu aplicación." />
  <UIProse as="article" bind:html="doc.html" />
  <UIPageNavigation bind:next="{ label: 'Rutas', to: '/routes' }" />
  <snippet name="footer"><UIFooter bind:brand="brand" /></snippet>
</UIPage>`,
	header: `<UIHeader bind:sticky="false" bind:brand="{ name: 'Meeko', href: '/' }"
  bind:items="[{ label: 'Guía', href: '/guide' }, { label: 'API', href: '/api' }]" current="/guide">
  <snippet name="actions"><UIButton size="sm">Entrar</UIButton></snippet>
</UIHeader>
<UIFooter bind:brand="{ name: 'Meeko', href: '/' }" description="Componentes tipados."
  bind:groups="[{ title: 'Producto', items: [{ label: 'Guía', href: '/guide' }] }]" />`,
	navigationTree: `<UINavigationTree label="Guía" current="/install" bind:groups="[
  { title: 'Primeros pasos', items: [
    { label: 'Instalación', href: '/install' },
    { label: 'UIButton', href: '/buttons', code: true, featured: true },
  ] },
]" />`,
	tabs: `<!-- Enlaces entre páginas -->
<UINavigationTabs label="Secciones" current="/metrics"
  bind:items="[{ label: 'Métricas', href: '/metrics' }, { label: 'Moderación', href: '/moderation' }]" />

<!-- Paneles de una misma página -->
<UITabs model="tab" label="Ajustes"
  bind:items="[{ value: 'account', label: 'Cuenta' }, { value: 'team', label: 'Equipo' }]">
  <snippet name="panel-account">Tu cuenta</snippet>
  <snippet name="panel-team">Tu equipo</snippet>
</UITabs>`,
	pagers: `<UIBreadcrumb bind:items="[{ label: 'Inicio', href: '/' }, { label: 'Guías', href: '/guides' }, { label: 'Tablas' }]" />
<UIPageNavigation bind:previous="{ label: 'Modal', to: '/modals' }" bind:next="{ label: 'Popover', to: '/popover' }" />
<UIPagination bind:shown="rows.value.length" bind:total="total" bind:hasMore="more.value"
  bind:busy="loading.value" on:loadMore="load" />

<!-- Numerada: la página en el modelo, o en la URL con pageLink -->
<UIPagination model:page="page" bind:total="total" bind:pageSize="20" edges />
<UIPagination bind:page="query.page" bind:pageCount="pages"
  bind:pageLink="(page) => ({ to: '/orders', search: { page: String(page) } })" />`,
	toc: `<UITableOfContents layout="collapsible"
  bind:entries="[{ id: 'usage', text: 'Uso', level: 2 }, { id: 'api', text: 'API', level: 2 }]" />`,
	locale: `<UILocaleSwitcher bind:items="[
  { code: 'es', label: 'Español', href: '/guide', current: true },
  { code: 'en', label: 'English', href: '/en/guide' },
]" />
<UILocaleSuggestion bind:items="items" suggested="en" on:stay="remember" />`,
	drawer: `<UIDrawer title="Filtros" triggerLabel="Abrir filtros" side="end" model="open">
  <UICheckbox model="drafts" label="Incluir borradores" />
  <snippet name="footer"><UIButton on:click="() => (open.value = false)">Aplicar</UIButton></snippet>
</UIDrawer>`,
	tooltip: `<UITooltip text="Se publica al guardar" placement="top">
  <snippet name="trigger">¿Cuándo se publica?</snippet>
</UITooltip>`,
	hint: `<h3>Ingresos <UIHint text="Importe cobrado, sin impuestos ni devoluciones." /></h3>
<p>
  Margen bruto
  <UIHint label="Qué es el margen" placement="bottom">Ingresos menos los <em>costes directos</em></UIHint>
</p>`,
	commandPalette: `<script lang="ts">
  const query = signal('')
  const pages = [{ title: 'Instalación', url: '/installation' }, { title: 'Temas', url: '/theming' }]
  const results = computed(() => pages.filter((page) => page.title.toLowerCase().includes(query.value.toLowerCase())))
</script>

<template>
  <UICommandPalette model:query="query" bind:results="results.value"
    bind:status="results.value.length ? 'ready' : 'empty'" hrefBy="url" labelBy="title" />
</template>`,
	editorConfig: `// pnpm add @milkdown/crepe @milkdown/kit @codemirror/language @codemirror/view \\
//   @codemirror/lang-javascript @codemirror/lang-html @codemirror/lang-css @codemirror/lang-json @lezer/highlight
// meeko.config.ts
export default defineMeekoConfig({
  modules: ['@meekojs/ui', '@meekojs/ui/editor'],
})`,
	editor: `<script lang="ts">
  const markdown = signal('# Título')
  const mode = signal<'visual' | 'code'>('visual')
</script>

<template>
  <UIMarkdownEditor label="Contenido" model="markdown" model:mode="mode" />
</template>`,
	combobox: `<UICombobox id="topics" model="chosen" bind:options="topics"
  name="topics" multiple searchable bind:max="2" placeholder="Busca un tema" />`,
	transitions: `// meeko.config.ts
export default defineMeekoConfig({ viewTransitions: true })

/* app/styles/main.css: el nombre, sólo durante la navegación, y un único elemento por vista */
html:active-view-transition-type(meeko-route) .project-card { view-transition-name: project; }

<!-- Enlace con navegación normal si prefieres omitir la transición -->
<MeekoLink to="/transitions/project"
  data-meeko-view-transition="false">Abrir sin transición</MeekoLink>`,
	icon: `<p><UIIcon name="lucide:search" /> Buscar en el proyecto</p>
<UIButton variant="outline" color="neutral">
  <UIIcon name="lucide:trash-2" label="Eliminar" />
</UIButton>`,
	iconConfig: `// pnpm add @meekojs/icon && pnpm add -D @iconify-json/lucide
// meeko.config.ts
export default defineMeekoConfig({
  modules: ['@meekojs/icon'],
  icon: {
    collections: ['lucide'], // @iconify-json/lucide del proyecto
    componentName: 'AppIcon', // UIIcon por defecto
    local: 'app/icons', // SVG propios: 'local:<nombre>'
    size: '1em',
    include: ['lucide:sun', 'lucide:moon'], // para bind:name
  },
})`,
	iconDynamic: `<!-- Literales de la expresión: se resuelven al compilar -->
<AppIcon
  bind:name="open.value ? 'lucide:x' : 'lucide:menu'"
  bind:label="open.value ? 'Cerrar menú' : 'Abrir menú'" />

<!-- Un valor que llega de datos: el icono debe estar en icon.include -->
<AppIcon bind:name="mode.value" />`,
	iconTypes: `import type { IconName } from '@meekojs/icon'

const close: IconName = 'lucide:x'`,
	iconLocal: `<!-- app/icons/paw.svg -->
<AppIcon name="local:paw" label="Meeko" size="1.5em" />`,
} as const
