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
    // Escape sequences (arrows, Home, F1, Alt+key, bracketed paste markers) are consumed whole, also
    // across chunks once their introducer arrived: none of their characters belong to the password.
    let escape: "none" | "esc" | "csi" | "ss3" | "string" | "string-esc" = "none";
    const onData = (chunk: string): void => {
      const characters = [...chunk];
      for (const [index, character] of characters.entries()) {
        const code = character.codePointAt(0)!;
        if (escape === "esc") {
          if (character === "[") escape = "csi";
          else if (character === "O") escape = "ss3";
          // OSC, DCS, SOS, PM and APC run until BEL or ESC \.
          else if ("]PX^_".includes(character)) escape = "string";
          else escape = "none";
          continue;
        }
        if (escape === "csi") {
          // Parameter and intermediate bytes (space to ?) continue it; a final byte (@ to ~) or
          // anything malformed ends it.
          if (code < 0x20 || code > 0x3f) escape = "none";
          continue;
        }
        if (escape === "ss3") { escape = "none"; continue; }
        if (escape === "string" || escape === "string-esc") {
          if (character === "\u0007" || (escape === "string-esc" && character === "\\")) escape = "none";
          else escape = character === "\u001b" ? "string-esc" : "string";
          continue;
        }
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u0003" || (character === "\u0004" && value === "")) { finish(new PromptCancelled()); return; }
        if (character === "\u007f" || character === "\b") { value = [...value].slice(0, -1).join(""); continue; }
        // A lone Escape key arrives as the last character of its chunk; a sequence continues.
        if (character === "\u001b") { escape = index === characters.length - 1 ? "none" : "esc"; continue; }
        if (character === "\u009b") { escape = "csi"; continue; }
        // Other C0 and C1 control characters are not part of a password.
        if (code < 0x20 || (code >= 0x80 && code <= 0x9f)) continue;
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
