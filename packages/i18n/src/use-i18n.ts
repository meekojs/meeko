import { inject } from "@meekojs/meeko";
import { i18nContext } from "./context";
import type { I18n } from "./context";

/** Reads the translator installed by the i18n module for this render root. */
export function useI18n(): I18n { return inject(i18nContext); }
