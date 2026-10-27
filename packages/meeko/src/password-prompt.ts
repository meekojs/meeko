// `meeko auth hash`: reads a password without echoing it and prints only its hash.

/** The terminal input that the prompt needs; `process.stdin` satisfies it. */
export interface PasswordInput {
  readonly isTTY?: boolean | undefined;
  setRawMode?(mode: boolean): unknown;
  setEncoding(encoding: "utf8"): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  off(event: "data", listener: (chunk: string) => void): unknown;
  resume(): unknown;
  pause(): unknown;
  [Symbol.asyncIterator]?(): AsyncIterator<string | Uint8Array>;
}

/** Where the prompts go; never stdout, which carries only the hash. */
export interface PromptOutput { write(text: string): unknown }

/** The user cancelled with Ctrl+C or Ctrl+D. */
export class PromptCancelled extends Error {
  constructor() { super("Cancelado"); this.name = "PromptCancelled"; }
}

/** Reads one line in raw mode without echo; Backspace edits, Ctrl+C and Ctrl+D cancel. */
function readHidden(input: PasswordInput, output: PromptOutput, prompt: string): Promise<string> {
  output.write(prompt);
  return new Promise((resolvePassword, reject) => {
    let value = "";
    const finish = (error?: Error): void => {
      input.off("data", onData);
      input.setRawMode?.(false);
      input.pause();
      output.write("\n");
      if (error) reject(error);
      else resolvePassword(value);
    };
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u0003" || (character === "\u0004" && value === "")) { finish(new PromptCancelled()); return; }
        if (character === "\u007f" || character === "\b") { value = [...value].slice(0, -1).join(""); continue; }
        // Other control characters (arrows, escape sequences) are not part of a password.
        if (character < " " || character === "\u001b") continue;
        value += character;
      }
    };
    input.setEncoding("utf8");
    input.setRawMode?.(true);
    input.on("data", onData);
    input.resume();
  });
}

/** Reads a piped password: the whole input without its final line break. */
async function readPiped(input: PasswordInput): Promise<string> {
  let text = "";
  const decoder = new TextDecoder();
  if (input[Symbol.asyncIterator]) {
    for await (const chunk of input as AsyncIterable<string | Uint8Array>) text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    text += decoder.decode();
  }
  const password = text.replace(/\r?\n$/, "");
  if (/[\r\n]/.test(password)) throw new Error("La entrada debe tener una sola línea con la contraseña");
  return password;
}

/**
 * Reads the password: twice without echo in a terminal, or once from a pipe
 * (`echo "$PASSWORD" | meeko auth hash`).
 */
export async function promptPassword(input: PasswordInput, output: PromptOutput): Promise<string> {
  if (!input.isTTY) return readPiped(input);
  const password = await readHidden(input, output, "Contraseña: ");
  if (!password) throw new Error("La contraseña está vacía");
  const confirmation = await readHidden(input, output, "Repite la contraseña: ");
  if (password !== confirmation) throw new Error("Las contraseñas no coinciden");
  return password;
}
