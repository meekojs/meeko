import { usePage } from "@meekojs/meeko/framework";

import type { I18n } from "./context";
import type { GeneratedI18nLocales } from "./index";
import type { Catalog, Message } from "./messages";

import { createI18n, localeOf } from "./runtime";

/**
 * Idioma configurado: los de los catálogos del proyecto, que genera el módulo, o cualquier texto sin
 * catálogos generados.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { I18nLocale } from "@meekojs/i18n/server";
 *
 * const locale: I18nLocale = "en";
 * ```
 */
export type I18nLocale = keyof GeneratedI18nLocales extends never ? string : keyof GeneratedI18nLocales & string;

/**
 * Traductor de la petición de una página, que devuelve {@link usePageI18n}. Es el de `useI18n()`,
 * con `locale` tipado con los idiomas de los catálogos y todos los namespaces cargados.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { PageI18n } from "@meekojs/i18n/server";
 *
 * function title(i18n: PageI18n): string {
 *   return i18n.t("docs.title");
 * }
 * ```
 */
export type PageI18n = Omit<I18n, "locale"> & { readonly locale: I18nLocale };

/** Every namespace of a locale. A process keeps one copy: the messages never change between requests. */
const loaded = new Map<string, Promise<Catalog>>();

function catalogOf(locale: string, namespaces: Readonly<Record<string, () => Promise<{ readonly default: Catalog }>>>): Promise<Catalog> {
  let catalog = loaded.get(locale);
  if (!catalog) {
    catalog = Promise.all(Object.values(namespaces).map((load) => load())).then((modules) => {
      const messages: Record<string, Message> = Object.create(null);
      for (const module of modules) Object.assign(messages, module.default);
      return messages;
    });
    loaded.set(locale, catalog);
  }
  return catalog;
}

/**
 * Idioma y traductor de la página en curso, para el `<script server>`, donde no hay `useI18n()`: ese
 * bloque también se ejecuta en la petición de datos de una navegación, sin aplicación ni plugins. El
 * idioma sale de la URL, como en el documento, y `t()`, `number()`, `date()` y `localePath()` funcionan
 * igual. En el servidor los catálogos no pesan en ningún bundle, así que están cargados todos los
 * namespaces de todos los idiomas. Se autoimporta en el código de servidor.
 *
 * @returns El traductor de la petición.
 * @throws {Error} `MEEK073` fuera del código de nivel superior de una página, como `usePage()`.
 * @since 0.1.0
 * @example
 * ```html
 * <script server lang="ts">
 * const { params } = usePage();
 * const { locale, t } = await usePageI18n();
 * export const doc = await readDoc(params.slug, locale);
 * export const head = { title: t("docs.title", { name: doc.title }) };
 * </script>
 * ```
 */
export async function usePageI18n(): Promise<PageI18n> {
  const { url } = usePage();
  // Only a Meeko build resolves this module: imported statically, this public entry would not load in plain Node.
  const { catalogs, settings } = await import("virtual:meeko-i18n");
  const { locales, defaultLocale, directions } = settings;
  const locale = localeOf(url.pathname, locales, defaultLocale);
  const entries = await Promise.all(locales.map(async (target) => [target, await catalogOf(target, catalogs[target]!)] as const));
  const all = Object.fromEntries(entries);
  const reported = new Set<string>();
  return createI18n({
    locale, locales, defaultLocale, directions, catalog: all[locale]!, foreign: all, cookie: false,
    path: () => `${url.pathname}${url.search}`,
    missing: (key, target) => {
      if (!reported.has(`${target}:${key}`)) console.warn(`[meeko:i18n] Missing message ${key} for ${target} in the <script server> of ${url.pathname}`);
      reported.add(`${target}:${key}`);
      return key;
    },
  }) as PageI18n;
}
