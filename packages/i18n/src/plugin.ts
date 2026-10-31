import { definePlugin } from "@meekojs/meeko/framework";
import { catalogs } from "virtual:meeko-i18n";
import { createI18n, localeOf } from "./runtime";
import { i18nContext } from "./context";
import type { Message } from "./messages";

interface Options {
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly directions: Readonly<Record<string, "ltr" | "rtl">>;
  readonly routes: Readonly<Record<string, readonly string[]>>;
}

export default definePlugin<Options>(async (app, options) => {
  const locale = localeOf(app.route.path.value, options.locales, options.defaultLocale);
  const loaders = catalogs[locale];
  if (!loaders) throw new RangeError(`i18n: missing catalog ${locale}`);
  const catalog: Record<string, Message> = Object.create(null);
  const loaded = new Set<string>();
  const load = async (routeId: string | null): Promise<void> => {
    const names = ["common", ...(options.routes[routeId ?? ""] ?? [])];
    for (const name of names) {
      if (loaded.has(name)) continue;
      const module = loaders[name];
      if (!module) throw new RangeError(`i18n: missing ${locale}/${name}`);
      Object.assign(catalog, (await module()).default);
      loaded.add(name);
    }
  };
  await load(app.route.id.value);
  app.provide(i18nContext, createI18n(locale, catalog, options.locales,
    (path) => { if (app.side === "client") window.location.assign(path); },
    () => app.route.url.value));
  app.addHead(() => ({ htmlAttrs: { lang: locale, dir: options.directions[locale] ?? "ltr" } }));
  if (app.side === "client") app.beforeNavigate(async (url, routeId) => {
    if (localeOf(url.pathname, options.locales, options.defaultLocale) !== locale) {
      window.location.assign(url.href);
      return false;
    }
    await load(routeId);
  });
});
