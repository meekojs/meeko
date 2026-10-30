import { inject } from "../../core/reactivity.js";
import { i18nContext } from "../../shared/i18n.js";
import type { I18n } from "../../shared/i18n.js";

/** Reads the translator installed by the i18n module for this render root. */
export function useI18n(): I18n { return inject(i18nContext); }
