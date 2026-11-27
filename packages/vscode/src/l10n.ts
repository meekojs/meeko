/**
 * Traducción de los textos de usuario sin depender de `vscode`, para que los módulos puros
 * (`scaffold.ts`, `status.ts`, `live/model.ts`…) sigan probándose con `node:test`.
 *
 * `extension.ts` instala `vscode.l10n.t` al activarse; sin traductor, {@link t} devuelve el
 * mensaje en inglés con los marcadores sustituidos, que es lo que ven las pruebas unitarias.
 *
 * Convenciones que comprueba `tests/l10n.test.ts`:
 *
 * - Todo texto de usuario de `src/**` pasa por `t`, nunca por `vscode.l10n.t` directamente.
 * - El primer argumento es siempre un literal de cadena en la misma llamada (`t('…', valor)`),
 *   entre comillas simples o dobles: ni plantillas, ni concatenaciones, ni variables. Así la
 *   prueba extrae las claves del código y las compara con `l10n/bundle.l10n.es.json`.
 * - Los valores se interpolan con marcadores `{0}`, `{1}`…, y la traducción usa los mismos.
 * - `t` se llama al mostrar el texto, no al cargar el módulo: una constante de módulo se
 *   evaluaría antes de que la extensión instale el traductor.
 */

/** Valor que puede sustituir a un marcador `{n}`. */
export type TranslationArgument = string | number | boolean

/** Firma de `vscode.l10n.t` con argumentos posicionales. */
export type Translator = (message: string, ...args: TranslationArgument[]) => string

/** Sustituye los marcadores `{n}` de `message`; uno sin argumento se deja como está. */
export function format(message: string, ...args: TranslationArgument[]): string {
	return message.replace(/\{(\d+)\}/g, (marker, index: string) => (Number(index) < args.length ? String(args[Number(index)]) : marker))
}

let translator: Translator = format

/**
 * Instala el traductor; la extensión pasa `vscode.l10n.t`. Sin argumento vuelve al inglés.
 *
 * @param next Traductor que recibe el mensaje en inglés y sus argumentos.
 */
export function setTranslator(next: Translator = format): void {
	translator = next
}

/**
 * Traduce un texto de usuario al idioma del editor.
 *
 * @param message Mensaje en inglés, que es también la clave de `l10n/bundle.l10n.<idioma>.json`.
 * @param args Valores de los marcadores `{0}`, `{1}`…
 */
export function t(message: string, ...args: TranslationArgument[]): string {
	return translator(message, ...args)
}
