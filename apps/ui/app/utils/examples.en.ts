import { examples as spanish } from './examples'

/** Copiable examples of the English pages: the same keys, with their texts and comments in English. What has none is shared. */
export const englishExamples = {
	...spanish,
	container: `<UIContainer as="section" size="4k" gutter="md" ariaLabel="Projects">
  <h2>Team projects</h2>
  <p>Centered content, with responsive side spacing.</p>
</UIContainer>`,
	containerNested: `<UIContainer size="4k">
  <header>Workspace header</header>
  <UIContainer size="lg" gutter="none">
    <h1>Reading content</h1>
    <p>A narrower width inside a wide surface.</p>
  </UIContainer>
</UIContainer>`,
	button: `<script lang="ts">
  const count = signal(0)
</script>

<template>
<UIButton on:click="() => count.value++">Save changes</UIButton>
<UIButton variant="outline">Cancel</UIButton>
<UIButton size="sm" disabled>Unavailable</UIButton>
<p role="status">Changes: {count.value}</p>
</template>`,
	buttonKinds: `<!-- A route of the application: navigates without reloading, with typed params and search -->
<UIButton to="/links">See links</UIButton>
<UIButton to="/users/[id]" bind:params="{ id: user.id }"
  bind:search="{ tab: 'activity' }">Profile</UIButton>

<!-- Any URL: an <a>; with target="_blank" it adds rel="noopener noreferrer" -->
<UIButton href="https://github.com/meekojs/meeko" target="_blank"
  variant="outline">GitHub</UIButton>
<UIButton href="/report.pdf" download="report.pdf">Download</UIButton>

<!-- Without to or href: a <button type="button"> -->
<UIButton type="submit" bind:disabled="saving.value">Save</UIButton>

<!-- id, title, aria-* and data-* reach the element -->
<UIButton aria-describedby="hint" data-testid="reset" on:click="reset">Reset</UIButton>`,
	card: `<script lang="ts">
  const count = signal(0)
</script>

<template>
<UICard title="Your workspace" variant="outline">
  <p role="status">Saved changes: {count.value}</p>
  <snippet name="footer">
    <UIButton on:click="() => count.value++">Save change</UIButton>
  </snippet>
</UICard>
</template>`,
	link: `<UILink to="/installation">Get started</UILink>
<UILink to="/users/[id]" bind:params="{ id: user.id }">Profile</UILink>
<UILink href="https://github.com/meekojs/meeko"
  target="_blank" variant="outline">GitHub</UILink>

<UILinkCard to="/theming" title="Customization"
  description="Connect the tokens to your brand." />`,
	badge: `<UIBadge>Information</UIBadge>
<UIBadge tone="accent">Published</UIBadge>
<UIBadge tone="danger">Review</UIBadge>`,
	form: `<script lang="ts">
  const name = signal('')
  const error = signal<string | undefined>(undefined)
  function save() {
    error.value = name.value.trim() ? undefined : 'Write a name.'
  }
</script>

<template>
  <UIField id="name" label="Name" bind:error="error.value" required>
    <snippet name="default" params="id, describedBy">
      <UIInput bind:id="id" bind:describedBy="describedBy"
        model="name" bind:invalid="Boolean(error.value)" required />
    </snippet>
  </UIField>
  <UIButton on:click="save">Save</UIButton>
</template>`,
	table: `<script lang="ts">
  import type { TableColumn } from '@meekojs/ui/runtime'

  interface Project { id: number; name: string; status: string }
  const columns = [
    { key: 'name', label: 'Project' },
    { key: 'status', label: 'Status', format: value => value.toUpperCase() },
  ] satisfies TableColumn<Project>[]
  const rows = signal<Project[]>([
    { id: 1, name: 'Main site', status: 'Published' },
  ])
</script>

<template>
  <UITable bind:columns="columns" bind:rows="rows.value"
    rowKey="id" caption="Team projects" />
</template>`,
	tableColumnSnippets: `<UITable bind:columns="columns" bind:rows="rows.value" rowKey="id">
  <!-- value is a string: the type of Project['status']. -->
  <snippet name="cell-status" params="row, value">
    <UIBadge bind:tone="value === 'Published' ? 'accent' : 'neutral'">{value}</UIBadge>
  </snippet>
  <snippet name="header-name" params="column">
    <abbr title="Project name">{column.label}</abbr>
  </snippet>
  <!-- name="cell-email" does not compile: Project has no email. -->
</UITable>`,
	select: `<script lang="ts">
  const plans = ['Personal', 'Team', 'Business', 'Education']
  const topics = ['Accessibility', 'Design', 'Documentation', 'Performance']
  const plan = signal<string | null>(null)
  const chosen = signal<string[]>([])
</script>

<template>
  <form method="post" action="/subscriptions">
    <label for="plan">Plan</label>
    <UISelect id="plan" model="plan" bind:options="plans"
      name="plan" placeholder="Choose a plan" required />

    <label for="topics">Topics</label>
    <UICombobox id="topics" model="chosen" bind:options="topics"
      name="topics" multiple searchable bind:max="2" />

    <UIButton type="submit">Send selection</UIButton>
  </form>
</template>`,
	selectObjects: `<script lang="ts">
  interface Member { id: number; name: string; team: string; role: string; disabled?: boolean }
  const members: Member[] = [
    { id: 1, name: 'Lucía Martín', team: 'Design', role: 'Art director' },
    { id: 4, name: 'Mateo Gil', team: 'Engineering', role: 'On vacation', disabled: true },
  ]
  const owner = signal<Member | null>(null)
</script>

<template>
  <UISelect model="owner" bind:options="members" by="id"
    labelBy="name" groupBy="team" label="Owner" clearable>
    <snippet name="option" params="member, state">
      <strong>{member.name}</strong>
      <small>{state.disabled ? 'Unavailable' : member.role}</small>
    </snippet>
  </UISelect>
</template>`,
	popoverMenu: `<script lang="ts">
  const action = signal('')
</script>

<template>
  <UIPopover role="menu" placement="bottom-start" bind:offset="6">
    <snippet name="trigger">Project actions</snippet>
    <UIButton variant="ghost" role="menuitem" on:click="() => (action.value = 'rename')">Rename</UIButton>
    <UIButton variant="ghost" role="menuitem" on:click="() => (action.value = 'duplicate')">Duplicate</UIButton>
    <UIButton variant="ghost" role="menuitem" on:click="() => (action.value = 'archive')">Archive</UIButton>
  </UIPopover>
</template>`,
	popoverDialog: `<script lang="ts">
  const opened = signal(false)
</script>

<template>
  <UIPopover role="dialog" label="Filter projects" model="opened">
    <snippet name="trigger">Filter</snippet>
    <UICheckbox label="Published" model="published" />
    <UIButton on:click="() => (opened.value = false)">Apply filters</UIButton>
  </UIPopover>
</template>`,
	popoverTooltip: `<UITooltip bind:offset="6">
  <snippet name="trigger">Status: draft</snippet>
  Only your team can see it until you publish it.
</UITooltip>`,
	popoverAnchor: `<UIPopover role="menu">
  <snippet name="anchor" params="trigger">
    <button type="button" class="avatar" bind="trigger">
      <img src="/avatar.png" alt="My account">
    </button>
  </snippet>
  <button role="menuitem">Profile</button>
  <button role="menuitem">Sign out</button>
</UIPopover>`,
	modal: `<script lang="ts">
  const opened = signal(false)
</script>

<template>
  <UIButton on:click="() => (opened.value = true)">Open</UIButton>
  <UIModal title="Edit project" model="opened" size="md">
    <p>Content of the dialog.</p>
    <snippet name="footer">
      <UIButton on:click="() => (opened.value = false)">Done</UIButton>
    </snippet>
  </UIModal>
</template>`,
	modalOpen: `const modal = useModal()

// Call this function from a user action.
async function confirm() {
  const accepted = await modal.open<boolean>('ModalConfirm', {
    message: 'Do you want to confirm this action?',
  })
  // boolean | undefined: dismissing returns undefined.
  return accepted
}`,
	modalInstance: `<!-- app/components/Modal/Confirm.meeko -->
<script lang="ts">
  const props = defineProps<{ message: string }>()

  const modal = useModalInstance<boolean>()
</script>

<template>
  <UIModal title="Confirm" bind:description="props.message">
    <snippet name="footer">
      <UIButton variant="outline" on:click="() => modal.dismiss()">Cancel</UIButton>
      <UIButton on:click="() => modal.close(true)">Confirm</UIButton>
    </snippet>
  </UIModal>
</template>`,
	theme: `import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
  modules: ['@meekojs/ui'],
  theme: { default: 'dark' },
  ui: {
    // Each key assigns --ui-* tokens; a var() reference follows the themes of your site.
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
    // Without @meekojs/i18n, the language of the texts; with it, the fallback of a language without texts.
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
	themeCss: `/* app/styles/main.css: your brand, over the steps of each scale */
:root {
  --ui-color-primary-9: #0a7cff;
  --ui-color-primary-10: #0067d6;
  --ui-radius-md: 0.5rem;
}
:root[data-theme='dark'] {
  --ui-color-primary-9: #3b96ff;
  --ui-color-primary-10: #66adff;
}`,
	buttonStates: `<UIButton tone="danger">Delete</UIButton>
<UIButton tone="danger" variant="outline">Revoke</UIButton>
<UIButton bind:loading="saving.value">Save</UIButton>
<UIButton iconOnly ariaLabel="Delete" variant="outline">
  <UIIcon name="lucide:trash-2" />
</UIButton>`,
	textarea: `<UIField id="comment" label="Comment" bind:counter="comment.value.length + '/200'">
  <snippet name="default" params="id, describedBy">
    <UITextarea model="comment" bind:id="id" bind:describedBy="describedBy"
      name="comment" bind:rows="4" bind:maxlength="200" />
  </snippet>
</UIField>`,
	checkbox: `<UICheckbox model="accepted" label="I accept the terms"
  description="You can withdraw it later." name="accepted" value="yes" required />
<UISwitch model="notifications" label="Notifications" name="notifications" />`,
	radio: `<script lang="ts">
  const period = signal('week')
  const periods = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'year', label: 'Year', disabled: true },
  ]
</script>

<template>
  <UIRadioGroup model="period" legend="Period" name="period" bind:options="periods" />
  <UIRadioGroup model="period" legend="Period" variant="segmented" bind:options="periods" />
</template>`,
	slider: `<UISlider model="volume" label="Volume" name="volume" bind:min="0" bind:max="100" bind:step="5" />`,
	alert: `<UIAlert tone="success" title="Changes saved" description="They are already published." />
<UIAlert tone="danger" title="Could not publish" dismiss on:dismiss="clear">
  <p>The database does not respond.</p>
  <snippet name="actions"><UIButton size="sm" on:click="retry">Retry</UIButton></snippet>
</UIAlert>`,
	toast: `<script lang="ts">
  const toast = useToast()
</script>

<template>
  <UIButton on:click="() => toast.add({ text: 'Changes saved', tone: 'success', duration: 5000 })">
    Save
  </UIButton>
</template>`,
	empty: `<UIEmpty variant="panel" title="No projects" description="Create the first one to get started.">
  <snippet name="actions"><UIButton>Create project</UIButton></snippet>
</UIEmpty>
<UISkeleton bind:lines="3" bind:widths="['full', 'long', 'short']" />`,
	stat: `<UIStat label="Visits" bind:value="1280" detail="Last 7 days" />
<UIDescriptionList bind:columns="2" bind:items="[
  { label: 'Status', value: 'Published', detail: 'Today' },
  { label: 'Author', value: 'Meeko team' },
]" />
<UIDisclosure summary="Technical details"><p>It opens without JavaScript.</p></UIDisclosure>`,
	diff: `<UIDiff label="Changes to the guide" bind:diff="patch" />`,
	diffSample: `--- a/guide.md
+++ b/guide.md
@@ -1,3 +1,3 @@
 # Guide
-Install with npm.
+Install with pnpm.
 Then, register the module.`,
	codeBlock: `<UICodeBlock label="Terminal" code="pnpm add @meekojs/ui" />
<UICodeBlock verdict="good" verdictLabel="Good" lang="ts" bind:code="good" />
<UICodeBlock mode="log" label="Log" bind:code="log" />
<UIProse as="article" bind:html="doc.html" />`,
	page: `<UIPage layout="docs">
  <snippet name="header">
    <UIHeader bind:brand="brand" bind:items="items">
      <snippet name="actions"><UIThemeToggle /></snippet>
    </UIHeader>
  </snippet>
  <snippet name="bar">
    <UIDrawer title="Contents" triggerLabel="Contents">
      <UINavigationTree bind:groups="groups" />
    </UIDrawer>
  </snippet>
  <snippet name="sidebar"><UINavigationTree bind:groups="groups" /></snippet>
  <snippet name="aside"><UITableOfContents bind:entries="toc" /></snippet>
  <UIPageHeader title="Installation" description="Add the package to your application." />
  <UIProse as="article" bind:html="doc.html" />
  <UIPageNavigation bind:next="{ label: 'Routes', to: '/routes' }" />
  <snippet name="footer"><UIFooter bind:brand="brand" /></snippet>
</UIPage>`,
	header: `<UIHeader bind:sticky="false" bind:brand="{ name: 'Meeko', href: '/' }"
  bind:items="[{ label: 'Guide', href: '/guide' }, { label: 'API', href: '/api' }]" current="/guide">
  <snippet name="actions"><UIButton size="sm">Sign in</UIButton></snippet>
</UIHeader>
<UIFooter bind:brand="{ name: 'Meeko', href: '/' }" description="Typed components."
  bind:groups="[{ title: 'Product', items: [{ label: 'Guide', href: '/guide' }] }]" />`,
	navigationTree: `<UINavigationTree label="Guide" current="/install" bind:groups="[
  { title: 'Getting started', items: [
    { label: 'Installation', href: '/install' },
    { label: 'UIButton', href: '/buttons', code: true, featured: true },
  ] },
]" />`,
	tabs: `<!-- Links between pages -->
<UINavigationTabs label="Sections" current="/metrics"
  bind:items="[{ label: 'Metrics', href: '/metrics' }, { label: 'Moderation', href: '/moderation' }]" />

<!-- Panels of the same page -->
<UITabs model="tab" label="Settings"
  bind:items="[{ value: 'account', label: 'Account' }, { value: 'team', label: 'Team' }]">
  <snippet name="panel-account">Your account</snippet>
  <snippet name="panel-team">Your team</snippet>
</UITabs>`,
	pagers: `<UIBreadcrumb bind:items="[{ label: 'Home', href: '/' }, { label: 'Guides', href: '/guides' }, { label: 'Tables' }]" />
<UIPageNavigation bind:previous="{ label: 'Modal', to: '/modals' }" bind:next="{ label: 'Popover', to: '/popover' }" />
<UIPagination bind:shown="rows.value.length" bind:total="total" bind:hasMore="more.value"
  bind:busy="loading.value" on:loadMore="load" />`,
	toc: `<UITableOfContents variant="collapsible"
  bind:entries="[{ id: 'usage', text: 'Usage', level: 2 }, { id: 'api', text: 'API', level: 2 }]" />`,
	drawer: `<UIDrawer title="Filters" triggerLabel="Open filters" side="end" model="open">
  <UICheckbox model="drafts" label="Include drafts" />
  <snippet name="footer"><UIButton on:click="() => (open.value = false)">Apply</UIButton></snippet>
</UIDrawer>`,
	tooltip: `<UITooltip text="It is published when you save" placement="top">
  <snippet name="trigger">When is it published?</snippet>
</UITooltip>`,
	commandPalette: `<script lang="ts">
  const query = signal('')
  const pages = [{ title: 'Installation', url: '/installation' }, { title: 'Theming', url: '/theming' }]
  const results = computed(() => pages.filter((page) => page.title.toLowerCase().includes(query.value.toLowerCase())))
</script>

<template>
  <UICommandPalette model:query="query" bind:results="results.value"
    bind:status="results.value.length ? 'ready' : 'empty'" hrefBy="url" labelBy="title" />
</template>`,
	editor: `<script lang="ts">
  const markdown = signal('# Title')
  const mode = signal<'visual' | 'code'>('visual')
</script>

<template>
  <UIMarkdownEditor label="Content" model="markdown" model:mode="mode" />
</template>`,
	combobox: `<UICombobox id="topics" model="chosen" bind:options="topics"
  name="topics" multiple searchable bind:max="2" placeholder="Search for a topic" />`,
	transitions: `// meeko.config.ts
export default defineMeekoConfig({ viewTransitions: true })

/* app/styles/main.css: the name, only during the navigation, and a single element per view */
html:active-view-transition-type(meeko-route) .project-card { view-transition-name: project; }

<!-- A link with a normal navigation if you prefer to skip the transition -->
<MeekoLink to="/transitions/project"
  data-meeko-view-transition="false">Open without a transition</MeekoLink>`,
	icon: `<p><UIIcon name="lucide:search" /> Search the project</p>
<UIButton variant="outline">
  <UIIcon name="lucide:trash-2" label="Delete" />
</UIButton>`,
	iconConfig: `// pnpm add @meekojs/icon && pnpm add -D @iconify-json/lucide
// meeko.config.ts
export default defineMeekoConfig({
  modules: ['@meekojs/icon'],
  icon: {
    collections: ['lucide'], // @iconify-json/lucide of the project
    local: 'app/icons', // your own SVG files: 'local:<name>'
    size: '1em',
    include: ['lucide:sun', 'lucide:moon'], // for bind:name
  },
})`,
	iconDynamic: `<!-- Literals of the expression: they are resolved at compile time -->
<UIIcon
  bind:name="open.value ? 'lucide:x' : 'lucide:menu'"
  bind:label="open.value ? 'Close menu' : 'Open menu'" />

<!-- A value that comes from data: the icon must be in icon.include -->
<UIIcon bind:name="mode.value" />`,
} as const satisfies Record<keyof typeof spanish, string>
