// Materialize the repository's documentation into one database snapshot.
// The public server reads the published snapshot, never the Markdown sources.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = join(site, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)
const vite = await createServer({
  root: site,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
})
let closeDatabase

try {
  const load = (name) => vite.ssrLoadModule(`/server/content/${name}.ts`)
  const [catalogModule, markdown, api, apiGroups, reference, taxonomy, repository, database, highlighting] = await Promise.all([
    load('catalog'), load('markdown'), load('api'), load('api-groups'),
    load('reference'), load('reference-taxonomy'), load('repository'), load('db'), load('highlight'),
  ])
  closeDatabase = database.closePool
  const pages = []
  const add = (path, payload) => pages.push({ path, payload })
  const tokenize = await highlighting.createTokenizer()
  const exampleFile = 'examples/counter/Counter.meeko'
  const exampleText = repository.readRepositoryFile(exampleFile).trim()
  const exampleLines = exampleText.split('\n')
  const markOf = (line) => (/\bsignal\(/.test(line) ? 'count' : /\bcomputed\(/.test(line) ? 'doubled' : /\{count\.value\}/.test(line) ? 'render' : undefined)
  const demo = {
    file: exampleFile,
    url: repository.githubUrl(exampleFile),
    lines: tokenize(exampleText, 'meeko').map((tokens, index) => {
      const html = tokens.map((token) => `<span style="${markdown.escapeHtml(token.style)}">${markdown.escapeHtml(token.content)}</span>`).join('')
      const mark = markOf(exampleLines[index] ?? '')
      return mark ? { html, mark } : { html }
    }),
    countLine: exampleLines.findIndex((line) => markOf(line) === 'count') + 1,
    doubledLine: exampleLines.findIndex((line) => markOf(line) === 'doubled') + 1,
  }
  const command = 'pnpm exec meeko init-framework mi-app'
  const highlight = await highlighting.createHighlight()
  add('/', {
    demo,
    editorLines: demo.lines.slice(9, 17).map((line, index) => ({ html: line.html, number: index + 10, count: line.mark === 'count' })),
    command,
    quickStart: markdown.codeBlockHtml('terminal', highlight([command, 'cd mi-app', 'npm install', 'npm run dev'].join('\n'), 'shellscript')),
    version: JSON.parse(repository.readRepositoryFile('package.json')).version,
    head: {
      title: 'Meeko · Componentes .meeko tipados, SSR e hidratación para TypeScript',
      description: 'Meeko es un motor de componentes para TypeScript y un framework full-stack: archivos .meeko tipados, signals, SSR con hidratación, API y RPC tipados y despliegue en Node, Bun, Deno y Cloudflare.',
    },
  })
  const { catalog, navigation, pager } = catalogModule
  const guides = await Promise.all(catalog.map(async (entry) => {
    const doc = await markdown.renderSource(entry.source, entry.transform)
    const source = repository.readRepositoryFile(entry.source)
    return { entry, doc, markdown: (entry.transform ?? ((text) => text))(source) }
  }))
  const sections = [...new Set(guides.map(({ entry }) => entry.section))].map((title) => ({
    title,
    docs: guides.filter(({ entry }) => entry.section === title).map(({ entry, doc }) => ({
      href: entry.href, section: entry.section, title: doc.title, description: doc.description,
    })),
  }))
  add('/docs', { sections })
  for (const { entry, doc } of guides) add(entry.href, {
    doc, nav: navigation(), pages: pager(entry.href), current: entry.href,
    head: { title: `${doc.title} · Meeko`, description: doc.description },
  })

  const groups = await reference.referenceIndex()
  const firstEntry = groups[0]?.entries[0]
  add('/docs/reference', {
    groups,
    total: groups.reduce((sum, group) => sum + group.entries.length, 0),
    modules: apiGroups.apiGroups().map((group) => ({
      id: group.id, label: group.specifier ?? group.title,
      href: apiGroups.groupHref(group), code: group.specifier !== null,
    })),
    exportsIcon: taxonomy.groupIcons.exports,
    exportsLink: apiGroups.exportsHref,
    nav: await reference.referenceNavigation(),
    current: apiGroups.referenceHref,
    toc: [...groups.map((group) => ({ id: group.anchor, text: group.title, level: 2 })),
      { id: 'todos-los-exports', text: 'Todos los exports', level: 2 }],
    pages: { previous: { href: '/docs/api', label: 'Componentes y API' },
      next: firstEntry ? { href: firstEntry.href, label: firstEntry.name } : null },
    source: taxonomy.taxonomyPath,
    editUrl: repository.githubUrl(taxonomy.taxonomyPath, 'edit'),
    head: { title: 'Referencia de la API · Meeko',
      description: 'Cada componente, macro, composable, función de reactividad, utilidad, directiva, API de servidor, adaptador, comando y opción de configuración de Meeko, con su tipo exacto, ejemplos y errores comunes.' },
  })

  const exportGroups = await api.apiIndex()
  const items = exportGroups.flatMap((group) => group.sections.flatMap((section) => section.items))
  const firstExport = exportGroups[0]?.sections[0]?.items[0]
  const exportSource = 'apps/site/server/content/api-groups.ts'
  add('/docs/reference/exports', {
    groups: exportGroups,
    total: items.length,
    kinds: api.apiKinds().map((entry) => ({ ...entry, count: items.filter((item) => item.kind === entry.kind).length }))
      .filter((entry) => entry.count > 0),
    nav: await reference.referenceNavigation(),
    current: apiGroups.exportsHref,
    toc: exportGroups.map((group) => ({ id: group.id, text: group.specifier ?? group.title, level: 2 })),
    pages: { previous: { href: apiGroups.referenceHref, label: 'Referencia de la API' },
      next: firstExport ? { href: firstExport.href, label: firstExport.name } : null },
    index: apiGroups.referenceHref,
    source: exportSource,
    editUrl: repository.githubUrl(exportSource, 'edit'),
    head: { title: 'Todos los exports · Referencia de la API · Meeko',
      description: 'Una página por cada export público de @meekojs/meeko y por cada macro, etiqueta y directiva de los componentes .meeko, generada desde el código fuente.' },
  })

  for (const symbol of new Set([...await api.apiSlugs(), ...await reference.referenceOnlySlugs()])) {
    const href = api.apiHref(symbol)
    const written = (await reference.referencePage(symbol)) ?? null
    const page = written ? null : ((await api.apiPage(symbol)) ?? null)
    if (!written && !page) throw new Error(`Missing reference page: ${symbol}`)
    const entry = await reference.referenceEntryAt(href)
    const title = written?.title ?? page?.name ?? symbol
    add(href, {
      written, page,
      nav: await reference.referenceNavigation(),
      current: entry ? entry.href : (page?.group.href ?? apiGroups.referenceHref),
      pages: (await reference.referencePager(href)) ?? (await api.apiPager(symbol)),
      toc: written?.toc ?? page?.toc ?? [],
      editUrl: written?.editUrl ?? page?.editUrl ?? '',
      editPath: written?.editPath ?? page?.editPath ?? '',
      index: apiGroups.referenceHref,
      searchTitle: `title:${title} · ${written ? written.kindLabel : (page?.specifier ?? 'sintaxis de .meeko')}`,
      head: { title: `${title} · Referencia de la API · Meeko`,
        description: written?.description ?? (page ? page.summary || `${page.name}, ${page.kindLabel} de ${page.specifier ?? 'los componentes .meeko'}.` : '') },
    })
  }

  add('/llms.txt', { text: await reference.llmsIndex(repository.siteOrigin, guides.map(({ entry, doc }) => ({
    title: doc.title, href: entry.href, description: doc.description,
  }))) })
  add('/llms-full.txt', { text: await reference.llmsFull(repository.siteOrigin, guides.map(({ entry, doc, markdown: source }) => ({
    title: doc.title, href: entry.href, markdown: source,
  }))) })
  await database.publishSnapshot(pages)
  console.log(`Published ${pages.length} documentation records`)
} finally {
  await closeDatabase?.()
  await vite.close()
}
