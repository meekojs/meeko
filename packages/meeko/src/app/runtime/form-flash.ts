import { createContext } from "../../core/reactivity.js";
import type { FormFlash } from "../../shared/form-flash.js";

/** What the server publishes for `useForm` while it renders a page. */
export interface FormFlashSource {
  /** The flash of this request, if the browser came back from a native submission. */
  readonly flash: FormFlash | undefined;
  /** The CSRF token of the session, for the `_csrf` field of a native form. */
  readonly csrfToken: string | undefined;
}

/** Published by the server's built-in form plugin during each page render. */
export const formFlashKey = /*#__PURE__*/ createContext<FormFlashSource>("Meeko native forms");
