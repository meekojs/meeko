declare module "virtual:meeko-i18n" {
  import type { Catalog } from "./messages";
  export const catalogs: Readonly<Record<string, Readonly<Record<string, () => Promise<{ default: Catalog }>>>>>;
}
