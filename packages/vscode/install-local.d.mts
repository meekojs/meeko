/**
 * El CLI de VS Code con el que se instala y localiza la extensión. En WSL prefiere el `code-server`
 * de `~/.vscode-server` al `code` de Windows, que localiza las extensiones de Windows.
 * @param command CLI indicado con `--code`.
 * @param env Entorno con `PATH` y `WSL_DISTRO_NAME`.
 * @param home Carpeta personal donde buscar `.vscode-server`.
 */
export function codeCli(command?: string, env?: NodeJS.ProcessEnv, home?: string): string | undefined
/**
 * Elige entre el `code` del `PATH` y el `code-server` remoto.
 * @param found `code` del `PATH`.
 * @param server `code-server` más reciente.
 * @param env Entorno con `WSL_DISTRO_NAME`.
 */
export function pickCodeCli(found: string | undefined, server: string | undefined, env: NodeJS.ProcessEnv): string | undefined
