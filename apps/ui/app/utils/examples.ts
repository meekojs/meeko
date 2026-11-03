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
	install: 'pnpm add @meekojs/ui',
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
    <UIButton variant="ghost" role="menuitem" on:click="() => (action.value = 'renombrar')">Renombrar</UIButton>
    <UIButton variant="ghost" role="menuitem" on:click="() => (action.value = 'duplicar')">Duplicar</UIButton>
    <UIButton variant="ghost" role="menuitem" on:click="() => (action.value = 'archivar')">Archivar</UIButton>
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
	themeUse: `.release-note {
  border: var(--ui-border-width) solid var(--ui-color-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-color-surface);
  padding: var(--ui-space-4);
  color: var(--ui-color-text-soft);
  font-size: var(--ui-font-size-md);
}`,
	buttonStates: `<UIButton tone="danger">Eliminar</UIButton>
<UIButton tone="danger" variant="outline">Revocar</UIButton>
<UIButton bind:loading="saving.value">Guardar</UIButton>
<UIButton iconOnly ariaLabel="Eliminar" variant="outline">
  <UIIcon name="lucide:trash-2" />
</UIButton>`,
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
  <UIRadioGroup model="period" legend="Periodo" variant="segmented" bind:options="periods" />
</template>`,
	slider: `<UISlider model="volume" label="Volumen" name="volume" bind:min="0" bind:max="100" bind:step="5" />`,
	alert: `<UIAlert tone="success" title="Cambios guardados" description="Ya están publicados." />
<UIAlert tone="danger" title="No se pudo publicar" dismiss on:dismiss="clear">
  <p>La base de datos no responde.</p>
  <snippet name="actions"><UIButton size="sm" on:click="retry">Reintentar</UIButton></snippet>
</UIAlert>`,
	toast: `<script lang="ts">
  const toast = useToast()
</script>

<template>
  <UIButton on:click="() => toast.add({ text: 'Cambios guardados', tone: 'success', duration: 5000 })">
    Guardar
  </UIButton>
</template>`,
	empty: `<UIEmpty variant="panel" title="Sin proyectos" description="Crea el primero para empezar.">
  <snippet name="actions"><UIButton>Crear proyecto</UIButton></snippet>
</UIEmpty>
<UISkeleton bind:lines="3" bind:widths="['full', 'long', 'short']" />`,
	stat: `<UIStat label="Visitas" bind:value="1280" detail="Últimos 7 días" />
<UIDescriptionList bind:columns="2" bind:items="[
  { label: 'Estado', value: 'Publicado', detail: 'Hoy' },
  { label: 'Autor', value: 'Equipo Meeko' },
]" />
<UIDisclosure summary="Detalles técnicos"><p>Se abre sin JavaScript.</p></UIDisclosure>`,
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
  bind:busy="loading.value" on:loadMore="load" />`,
	toc: `<UITableOfContents variant="collapsible"
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
	iconTypes: `import type { IconName } from '@meekojs/icon'

const close: IconName = 'lucide:x'`,
	iconLocal: `<!-- app/icons/paw.svg -->
<UIIcon name="local:paw" label="Meeko" size="1.5em" />`,
} as const
