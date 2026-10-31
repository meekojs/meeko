import type { I18n } from "./context";
import type { Catalog, Message } from "./messages";

type Values = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** Locale of a URL path; an unprefixed path uses the configured default. */
export function localeOf(path: string, locales: readonly string[], fallback: string): string {
  const first = path.split("/")[1];
  return first && locales.includes(first) ? first : fallback;
}

export function localizedPath(path: string, locale: string, locales: readonly string[]): string {
  const url = new URL(path, "http://meeko.invalid");
  const segments = url.pathname.split("/");
  if (locales.includes(segments[1] ?? "")) segments.splice(1, 1);
  url.pathname = `/${locale}${segments.join("/") === "/" ? "" : segments.join("/")}`;
  return `${url.pathname}${url.search}${url.hash}`;
}

function render(parts: Extract<Message, readonly unknown[]>, values: Values): string {
  let result = "";
  for (const part of parts) {
    if (typeof part === "string") result += part;
    else {
      const value = values[part.arg];
      if (value === undefined || value === null) throw new TypeError(`Missing i18n value ${part.arg}`);
      result += String(value);
    }
  }
  return result;
}

/** Builds one request or tab translator; formatter instances are cached per options. */
export function createI18n(locale: string, catalog: Catalog, locales: readonly string[], navigate: (path: string) => void, path: () => string): I18n {
  const plurals = new Intl.PluralRules(locale);
  const numbers = new Map<string, Intl.NumberFormat>();
  const dates = new Map<string, Intl.DateTimeFormat>();
  return {
    locale,
    t(key: string, ...request: readonly unknown[]) {
      // La firma pública correlaciona clave y valores; el runtime interpreta el catálogo ya validado.
      const values = request[0] === undefined ? {} : request[0] as Values;
      const message = catalog[key];
      if (message === undefined) throw new ReferenceError(`Missing i18n message ${key} for ${locale}`);
      if (Array.isArray(message)) return render(message, values);
      const selected = message as Exclude<Message, readonly unknown[]>;
      if ("plural" in selected) {
        const value = values[selected.plural];
        if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${key}: ${selected.plural} must be a finite number`);
        return render(selected.forms[`=${value}`] ?? selected.forms[plurals.select(value)] ?? selected.forms.other!, { ...values, count: value });
      }
      const value = values[selected.select];
      return render(selected.forms[String(value)] ?? selected.forms.other!, values);
    },
    number(value, options) {
      const id = JSON.stringify(options ?? {});
      let formatter = numbers.get(id);
      if (!formatter) numbers.set(id, formatter = new Intl.NumberFormat(locale, options));
      return formatter.format(value);
    },
    date(value, options) {
      const id = JSON.stringify(options ?? {});
      let formatter = dates.get(id);
      if (!formatter) dates.set(id, formatter = new Intl.DateTimeFormat(locale, options));
      return formatter.format(value);
    },
    switchLocale(target) {
      if (!locales.includes(target)) throw new RangeError(`Unsupported locale ${target}`);
      navigate(localizedPath(path(), target, locales));
    },
  };
}
