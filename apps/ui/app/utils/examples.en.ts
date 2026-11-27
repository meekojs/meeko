import { examples as spanish } from './examples'

/** Copiable examples of the English pages: the same keys, with their texts and comments in English. What has none is shared. */
export const englishExamples = {
	...spanish,
	stylesWithoutPreflight: `/* Tailwind without its preflight: its theme and its utilities, in their layers */
@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
@import '@meekojs/ui';`,
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
<UIButton variant="outline" color="neutral">Cancel</UIButton>
<UIButton size="sm" disabled>Unavailable</UIButton>
<p role="status">Changes: {count.value}</p>
</template>`,
	buttonAppearance: `<UIButton variant="solid" color="primary" size="lg" radius="full" elevation="sm">Save</UIButton>
<UIButton variant="soft" color="success" size="sm">Publish</UIButton>
<UIButton variant="outline" color="info">outline</UIButton>
<UIButton variant="ghost" color="primary">ghost</UIButton>
<UIButton variant="link" color="primary">link</UIButton>`,
	badgeAppearance: `<UIBadge variant="solid" color="info" radius="sm">Published</UIBadge>
<UIBadge
	dot
	variant="outline"
	color="warning"
	radius="full"
>
	Pending
</UIBadge>
<UIBadge variant="soft" color="success">soft</UIBadge>
<UIBadge variant="surface" color="info">surface</UIBadge>`,
	inputAppearance: `<label for="appearance-email">Work email</label>
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
	title="Weekly summary"
	color="primary"
	radius="xl"
	elevation="md"
>
	3 projects updated
</UICard>
<UICard
	title="outline"
	variant="outline"
	color="primary"
>
	3 projects updated
</UICard>
<UICard
	title="glass"
	variant="glass"
	color="primary"
>
	3 projects updated
</UICard>
<UICard
	title="plain"
	variant="plain"
	color="primary"
>
	3 projects updated
</UICard>`,
	buttonKinds: `<!-- A route of the application: navigates without reloading, with typed params and search -->
<UIButton to="/links">See links</UIButton>
<UIButton to="/users/[id]" bind:params="{ id: user.id }"
  bind:search="{ tab: 'activity' }">Profile</UIButton>

<!-- Any URL: an <a>; with target="_blank" it adds rel="noopener noreferrer" -->
<UIButton href="https://github.com/meekojs/meeko" target="_blank"
  variant="outline"
  color="neutral">GitHub</UIButton>
<UIButton href="/report.pdf" download="report.pdf">Download</UIButton>

<!-- Without to or href: a <button type="button"> -->
<UIButton type="submit" bind:disabled="saving.value">Save</UIButton>

<!-- id, title, aria-* and data-* reach the element -->
<UIButton aria-describedby="hint" data-testid="reset" on:click="reset">Reset</UIButton>`,
	card: `<script lang="ts">
  const count = signal(0)
</script>

<template>
<UICard title="Your workspace">
  <p role="status">Saved changes: {count.value}</p>
  <snippet name="footer">
    <UIButton on:click="() => count.value++">Save change</UIButton>
  </snippet>
</UICard>
</template>`,
	link: `<UILink to="/installation">Get started</UILink>
<UILink to="/users/[id]" bind:params="{ id: user.id }">Profile</UILink>
<UILink href="https://github.com/meekojs/meeko"
  target="_blank" variant="outline" color="neutral">GitHub</UILink>

<UILinkCard to="/theming" title="Customization"
  description="Connect the tokens to your brand." />`,
	badge: `<UIBadge>Information</UIBadge>
<UIBadge color="primary">Published</UIBadge>
<UIBadge color="danger">Review</UIBadge>`,
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
    <UIBadge bind:color="value === 'Published' ? 'primary' : 'neutral'">{value}</UIBadge>
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
    <UIButton variant="ghost" color="neutral" role="menuitem" on:click="() => (action.value = 'rename')">Rename</UIButton>
    <UIButton variant="ghost" color="neutral" role="menuitem" on:click="() => (action.value = 'duplicate')">Duplicate</UIButton>
    <UIButton variant="ghost" color="neutral" role="menuitem" on:click="() => (action.value = 'archive')">Archive</UIButton>
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
	menu: `<script lang="ts">
  import type { UIMenuEntry } from '@meekojs/ui/runtime'

  const items: UIMenuEntry[] = [
    { label: 'Rename', shortcut: 'F2', onSelect: () => rename() },
    { label: 'Duplicate', onSelect: () => duplicate() },
    { label: 'See Popover', to: '/popover' },
    { label: 'Archive', disabled: true },
    { separator: true },
    { label: 'Delete', color: 'danger', onSelect: () => remove() },
  ]
</script>

<template>
  <UIMenu triggerLabel="Project actions" bind:items="items" on:select="(item) => console.log(item.label)" />
</template>`,
	menuRow: `<UITable caption="Files" bind:hideCaption="true" rowKey="id" bind:rows="files" bind:columns="columns">
  <snippet name="cell-actions" params="file">
    <UIMenu bind:ariaLabel="'Actions for ' + file.name" size="sm" placement="bottom-end" bind:items="actionsOf(file)" />
  </snippet>
</UITable>`,
	menuSnippets: `<UIMenu label="Account" bind:items="[{ label: 'Profile', to: '/profile' }, { label: 'Sign out', onSelect: logout }]">
  <snippet name="trigger"><img src="/me.png" alt="My account" width="24" height="24" /></snippet>
  <snippet name="item" params="item"><strong>{item.label}</strong></snippet>
  <button type="button" role="menuitem" on:click="openHelp">Help</button>
</UIMenu>`,
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
      <UIButton variant="outline" color="neutral" on:click="() => modal.dismiss()">Cancel</UIButton>
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
	themeColor: `/* app/styles/main.css: primary reads the crimson scale */
@import 'tailwindcss';
@import '@meekojs/ui';
@import '@meekojs/ui/hues';

/* With [data-theme] it also wins over the steps of UI's dark theme */
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
	themeSlots: `<!-- class reaches the root; ui, each part by the name of its slot -->
<UICard title="Pro plan" class="pricing-card"
  bind:ui="{ header: 'pricing-header', title: 'pricing-title' }">
  <p>Everything in the basic plan, with no limits.</p>
</UICard>
<UIBadge color="success" dot bind:ui="{ dot: 'pulse' }">Published</UIBadge>`,
	themeSlotsCss: `/* app/styles/main.css: without @layer, it wins over the component's classes */
.pricing-card {
  border-color: var(--ui-color-primary-border);
}
.pricing-title {
  color: var(--ui-color-primary-text);
}`,
	buttonStates: `<UIButton color="danger">Delete</UIButton>
<UIButton color="danger" variant="outline">Revoke</UIButton>
<UIButton bind:loading="saving.value">Save</UIButton>
<UIButton iconOnly ariaLabel="Delete" variant="outline" color="neutral">
  <UIIcon name="lucide:trash-2" />
</UIButton>`,
	iconButton: `<UIIconButton label="Open the menu" icon="menu" />
<UIIconButton label="Close" icon="close" variant="outline" />
<UIIconButton label="Confirm" icon="check" variant="solid" color="primary" on:click="confirm" />
<UIIconButton label="See links" icon="arrowEnd" to="/links" />
<UIIconButton label="Delete">
  <UIIcon name="lucide:trash-2" />
</UIIconButton>`,
	iconButtonStates: `<UIIconButton label="Pin the panel" icon="check" variant="outline"
  bind:pressed="pinned.value" on:click="() => (pinned.value = !pinned.value)" />
<UIIconButton label="Remove" icon="close" color="danger" />
<UIIconButton label="Saving" icon="check" bind:loading="saving.value" />
<UIIconButton label="Small" icon="menu" size="sm" />
<UIIconButton label="No tooltip" icon="menu" bind:tooltip="false" />`,
	copyButton: `<script lang="ts">
  const copies = signal(0)
</script>

<template>
<UICopyButton value="pnpm add @meekojs/ui" on:copy="() => copies.value++" />
<UICopyButton value="https://ui.meekojs.com" label="Copy link" variant="outline" size="sm" />
<UICopyButton value="sk_test_4f8a" iconOnly label="Copy the token"
  on:copyError="(error) => console.warn(error)" />
</template>`,
	copyButtonTokens: `/* The colors of the result, only where the text is not on a solid */
.billing {
  --ui-copy-button-copied-color: var(--ui-color-info-text);
  --ui-copy-button-failed-color: var(--ui-color-warning-text);
}`,
	modalConfirm: `const modal = useModal()

async function remove() {
  const confirmed = await modal.confirm({
    title: 'Delete the project?',
    description: 'Its files are deleted and it cannot be undone.',
    confirmLabel: 'Delete',
    color: 'danger',
  })
  if (confirmed) await deleteProject()
}`,
	nativeElements: `<progress value="0.6" aria-label="Upload"></progress>
<progress aria-label="Loading"></progress>

<meter min="0" max="100" low="25" high="75" optimum="100" value="90">90%</meter>
<meter min="0" max="100" low="25" high="75" optimum="100" value="50">50%</meter>
<meter min="0" max="100" low="25" high="75" optimum="100" value="10">10%</meter>

<input type="file" accept="image/*" multiple aria-label="Photos" />`,
	nativeElementsTokens: `:root {
  --ui-progress-height: 0.25rem;
  --ui-progress-color: var(--ui-color-success);
  --ui-meter-suboptimum-color: var(--ui-color-orange-9);
  --ui-file-button-bg: var(--ui-color-primary-soft);
}`,
	navigationProgress: `/* Thicker, another color and more patient */
:root {
  --ui-navigation-progress-height: 0.1875rem;
  --ui-navigation-progress-color: var(--ui-color-info);
  --ui-navigation-progress-delay: 250ms;
}

/* No bar */
:root {
  --ui-navigation-progress-height: 0;
}`,
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
	segmented: `<script lang="ts">
  const days = signal('30')
  const options = [
    { value: '7', label: '7 days' },
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
  ]
</script>

<template>
  <form method="get">
    <UISegmentedControl legend="Chart period" hideLegend size="sm" name="days" model="days" bind:options="options" />
  </form>
</template>`,
	dateRange: `<script lang="ts">
  import type { UIDateRangeValue } from '@meekojs/ui/runtime'

  const from = signal('')
  const to = signal('')
  // The server's “today”: the shortcuts are active in the HTML and match on hydration.
  const today = '2026-11-24'
  function load(range: UIDateRangeValue) {
    // Only a complete and valid range arrives.
  }
</script>

<template>
  <UIDateRange label="Period" model:from="from" model:to="to"
    fromName="from" toName="to" bind:today="today"
    min="2020-01-01" bind:max="today" bind:maxDays="366" on:change="load" />
</template>`,
	dateRangeField: `<UIField id="period" label="Sales period" hint="Up to 366 days">
  <snippet name="default" params="id, describedBy">
    <UIDateRange bind:id="id" bind:describedBy="describedBy"
      model:from="from" model:to="to" bind:maxDays="366" bind:presets="[]" />
  </snippet>
</UIField>`,
	slider: `<UISlider model="volume" label="Volume" name="volume" bind:min="0" bind:max="100" bind:step="5" />`,
	alert: `<UIAlert color="success" title="Changes saved" description="They are already published." />
<UIAlert color="danger" title="Could not publish" dismiss on:dismiss="clear">
  <p>The database does not respond.</p>
  <snippet name="actions"><UIButton size="sm" on:click="retry">Retry</UIButton></snippet>
</UIAlert>`,
	toast: `<script lang="ts">
  const toast = useToast()
</script>

<template>
  <UIButton on:click="() => toast.add({ text: 'Changes saved', color: 'success', duration: 5000 })">
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
	kpi: `<!-- A key figure: change with its color, period, trend and a link to the detail -->
<UIStat label="Revenue" value="€12,400" bind:change="12.5"
  period="vs. the previous 30 days"
  bind:trend="[8.2, 9.1, 8.7, 10.4, 11.2, 10.9, 12.4]" to="/revenue" />

<!-- Down is good: a response time that goes down is a success -->
<UIStat label="Response time" value="180 ms" bind:change="-8" good="down" />

<!-- A text already formatted: its sign gives the direction -->
<UIStat label="Orders" bind:value="320" change="−8 orders" period="this month" />

<!-- A sparkline on its own, with an area -->
<UISparkline bind:values="visits" area color="primary" />`,
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
  bind:busy="loading.value" on:loadMore="load" />

<!-- Numbered: the page in the model, or in the URL with pageLink -->
<UIPagination model:page="page" bind:total="total" bind:pageSize="20" edges />
<UIPagination bind:page="query.page" bind:pageCount="pages"
  bind:pageLink="(page) => ({ to: '/orders', search: { page: String(page) } })" />`,
	toc: `<UITableOfContents variant="collapsible"
  bind:entries="[{ id: 'usage', text: 'Usage', level: 2 }, { id: 'api', text: 'API', level: 2 }]" />`,
	drawer: `<UIDrawer title="Filters" triggerLabel="Open filters" side="end" model="open">
  <UICheckbox model="drafts" label="Include drafts" />
  <snippet name="footer"><UIButton on:click="() => (open.value = false)">Apply</UIButton></snippet>
</UIDrawer>`,
	tooltip: `<UITooltip text="It is published when you save" placement="top">
  <snippet name="trigger">When is it published?</snippet>
</UITooltip>`,
	hint: `<h3>Revenue <UIHint text="Amount collected, before taxes and refunds." /></h3>
<p>
  Gross margin
  <UIHint label="What the margin is" placement="bottom">Revenue minus the <em>direct costs</em></UIHint>
</p>`,
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
<UIButton variant="outline" color="neutral">
  <UIIcon name="lucide:trash-2" label="Delete" />
</UIButton>`,
	iconConfig: `// pnpm add @meekojs/icon && pnpm add -D @iconify-json/lucide
// meeko.config.ts
export default defineMeekoConfig({
  modules: ['@meekojs/icon'],
  icon: {
    collections: ['lucide'], // @iconify-json/lucide of the project
    componentName: 'AppIcon', // UIIcon by default
    local: 'app/icons', // your own SVG files: 'local:<name>'
    size: '1em',
    include: ['lucide:sun', 'lucide:moon'], // for bind:name
  },
})`,
	iconDynamic: `<!-- Literals of the expression: they are resolved at compile time -->
<AppIcon
  bind:name="open.value ? 'lucide:x' : 'lucide:menu'"
  bind:label="open.value ? 'Close menu' : 'Open menu'" />

<!-- A value that comes from data: the icon must be in icon.include -->
<AppIcon bind:name="mode.value" />`,
} as const satisfies Record<keyof typeof spanish, string>
