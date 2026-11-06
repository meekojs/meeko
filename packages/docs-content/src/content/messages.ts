import type { DocsLocale } from '../locale'

import { currentLocale } from './repository'

/*
 * The texts that the render writes itself, around the content of the documents: labels of the
 * sidebar, titles of the head, the code blocks and callouts, and the text of `llms.txt`. The
 * documents bring their own text, translated in `docs/en/**`; these are the render's.
 */

const es = {
	copy: 'Copiar',
	good: 'Correcto',
	bad: 'Incorrecto',
	note: 'Nota',
	tip: 'Consejo',
	important: 'Importante',
	warning: 'Advertencia',
	caution: 'Cuidado',
	headingAnchor: 'Enlace a esta sección',
	quickStart: 'Inicio rápido',
	documentation: 'Documentación',
	reference: 'Referencia de Meeko',
	referenceIndex: 'Índice de símbolos',
	allExports: 'Todos los exports',
	exportsByModule: 'Índice por módulo',
	meekoSyntax: 'sintaxis de .meeko',
	meekoComponents: 'los componentes .meeko',
	kindOf: (name: string, kind: string, of: string): string => `${name}, ${kind} de ${of}.`,
	homeTitle: 'Meeko · Crea aplicaciones web con TypeScript y componentes .meeko',
	homeDescription: 'Construye páginas con componentes .meeko tipados, HTML del servidor e interacciones con signals. El framework añade rutas, datos y contratos HTTP o RPC; el motor también funciona en Vite.',
	appName: 'mi-app',
	referenceDescription: 'Cada componente, macro, composable, función de reactividad, utilidad, directiva, API de servidor, adaptador, comando y opción de configuración de Meeko, con su tipo exacto, ejemplos y errores comunes.',
	exportsDescription: 'Una página por cada export público de @meekojs/meeko y por cada macro, etiqueta y directiva de los componentes .meeko, generada desde el código fuente.',
	usage: 'Uso',
	type: 'Tipo',
	related: 'Relacionado',
	llmsSummary: 'Meeko es un motor de componentes `.meeko` tipados con SSR, hidratación y señales, y un framework full-stack (rutas, API y RPC tipados, sesiones, WebSocket) para Node, Bun, Deno y Cloudflare Workers. Documentación en español.',
	llmsIntro: (full: string): string => `Cada página de la referencia explica un símbolo con su tipo exacto, generado desde el código fuente, sus parámetros, ejemplos y errores comunes. [${full}](${full}) reúne en un solo archivo las guías y la referencia en Markdown.`,
	llmsGuides: 'Guías',
	llmsReference: (group: string): string => `Referencia: ${group}`,
	llmsExports: 'índice de cada export de cada módulo de @meekojs/meeko, generado desde su JSDoc.',
	llmsFullTitle: '# Meeko: guías y referencia de la API',
	llmsFullSource: (origin: string): string => `Fuente: ${origin}. Cada sección empieza con la URL de su página.`,
}

/** The texts of the render in a language. */
export type Messages = typeof es

const en: Messages = {
	copy: 'Copy',
	good: 'Correct',
	bad: 'Incorrect',
	note: 'Note',
	tip: 'Tip',
	important: 'Important',
	warning: 'Warning',
	caution: 'Caution',
	headingAnchor: 'Link to this section',
	quickStart: 'Quick start',
	documentation: 'Documentation',
	reference: 'Meeko reference',
	referenceIndex: 'Symbol index',
	allExports: 'All exports',
	exportsByModule: 'Index by module',
	meekoSyntax: '.meeko syntax',
	meekoComponents: '.meeko components',
	kindOf: (name, kind, of) => `${name}, ${kind} of ${of}.`,
	homeTitle: 'Meeko · Build web apps with TypeScript and .meeko components',
	homeDescription: 'Build pages with typed .meeko components, server HTML and signal driven interactions. The framework adds routes, data and HTTP or RPC contracts; the engine also works with Vite.',
	appName: 'my-app',
	referenceDescription: 'Every component, macro, composable, reactivity function, utility, directive, server API, adapter, command and configuration option of Meeko, with its exact type, examples and common mistakes.',
	exportsDescription: 'One page for each public export of @meekojs/meeko and for each macro, tag and directive of .meeko components, generated from the source code.',
	usage: 'Usage',
	type: 'Type',
	related: 'Related',
	llmsSummary: 'Meeko is an engine of typed `.meeko` components with SSR, hydration and signals, and a full-stack framework (typed routes, API and RPC, sessions, WebSocket) for Node, Bun, Deno and Cloudflare Workers. Documentation in English.',
	llmsIntro: (full) => `Each page of the reference explains one symbol with its exact type, generated from the source code, its parameters, examples and common mistakes. [${full}](${full}) gathers the guides and the reference in Markdown in a single file.`,
	llmsGuides: 'Guides',
	llmsReference: (group) => `Reference: ${group}`,
	llmsExports: 'index of every export of every module of @meekojs/meeko, generated from its JSDoc.',
	llmsFullTitle: '# Meeko: guides and API reference',
	llmsFullSource: (origin) => `Source: ${origin}. Each section starts with the URL of its page.`,
}

const catalogs: Readonly<Record<DocsLocale, Messages>> = { es, en }

/** The texts of the render in `locale`, or in the language of the current render. */
export function messages(locale: DocsLocale = currentLocale()): Messages {
	return catalogs[locale]
}
