/** Expresión `{...}` encontrada en un texto de plantilla, con posiciones relativas a ese texto. */
export interface InterpolationSegment {
  /** Posición de la llave de apertura. */
  start: number;
  /** Posición siguiente a la llave de cierre. */
  end: number;
  /** Expresión sin espacios exteriores; conserva el salto de línea que cierra un comentario `//` final. */
  expression: string;
  /** Posición del primer carácter de `expression`. */
  expressionStart: number;
}

/** Resultado de analizar las interpolaciones de un texto de plantilla. */
export interface InterpolationScan {
  segments: InterpolationSegment[];
  /** Posición de la llave de apertura de una interpolación que no se cierra. */
  unterminated?: number;
}

interface CodeEnd {
  close: number;
  lineCommentEnd: number;
}

const regexKeywords = new Set(["await", "case", "delete", "do", "else", "in", "instanceof", "new", "of", "return", "throw", "typeof", "void", "yield"]);
const regexPunctuators = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const wordCharacter = /[\p{ID_Continue}$\u200C\u200D]/u;
const lineTerminator = /[\n\r\u2028\u2029]/;

/**
 * Localiza expresiones `{...}` de un texto de plantilla respetando llaves anidadas, cadenas,
 * plantillas literales con `${...}`, comentarios y expresiones regulares de JavaScript.
 * Compilador y editor comparten este análisis para producir las mismas posiciones.
 */
export function scanInterpolations(text: string): InterpolationScan {
  const segments: InterpolationSegment[] = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("{", index);
    if (open < 0) break;
    const end = scanCode(text, open + 1);
    if (!end) return { segments, unterminated: open };
    segments.push(segment(text, open, end));
    index = end.close + 1;
  }
  return { segments };
}

function segment(text: string, open: number, { close, lineCommentEnd }: CodeEnd): InterpolationSegment {
  const raw = text.slice(open + 1, close);
  const trimmed = raw.trim();
  const expressionStart = open + 1 + (trimmed ? raw.length - raw.trimStart().length : 0);
  // Un comentario `//` al final necesita su salto de línea para no anular el código que lo rodea.
  const endsInLineComment = trimmed !== "" && lineCommentEnd >= expressionStart && !text.slice(lineCommentEnd, close).trim();
  const expression = endsInLineComment ? text.slice(expressionStart, lineCommentEnd + 1) : trimmed;
  return { start: open, end: close + 1, expression, expressionStart };
}

/** Recorre código hasta la llave que cierra el nivel inicial; `undefined` si el texto termina antes. */
function scanCode(text: string, start: number): CodeEnd | undefined {
  let depth = 0;
  let previous = "";
  let lineCommentEnd = -1;
  let index = start;
  while (index < text.length) {
    const char = text[index]!;
    const next = text[index + 1];
    const regexEnd = char === "/" && next !== "/" && next !== "*" && regexAllowed(previous) ? skipRegex(text, index) : -1;
    if (char === "/" && next === "/") {
      const newline = findLineTerminator(text, index + 2);
      if (newline < 0) return undefined;
      lineCommentEnd = newline;
      index = newline + 1;
    } else if (char === "/" && next === "*") {
      const close = text.indexOf("*/", index + 2);
      if (close < 0) return undefined;
      index = close + 2;
    } else if (/\s/.test(char)) {
      index++;
    } else if (char === "'" || char === '"') {
      const end = skipString(text, index, char);
      if (end < 0) return undefined;
      index = end;
      previous = "value";
    } else if (char === "`") {
      const end = skipTemplate(text, index);
      if (end < 0) return undefined;
      index = end;
      previous = "value";
    } else if (regexEnd > 0) {
      index = regexEnd;
      previous = "value";
    } else if (char === "{") {
      depth++;
      previous = char;
      index++;
    } else if (char === "}") {
      if (depth === 0) return { close: index, lineCommentEnd };
      depth--;
      previous = char;
      index++;
    } else if (wordCharacter.test(char)) {
      let end = index + 1;
      while (end < text.length && wordCharacter.test(text[end]!)) end++;
      // `obj.return / 2` divides: a keyword used as a property name is a value.
      previous = previous !== "." && regexKeywords.has(text.slice(index, end)) ? "keyword" : "value";
      index = end;
    } else if ((char === "+" || char === "-") && next === char) {
      // `i++ / 2` divides after a postfix update; a prefix update is followed by its operand.
      previous = "value";
      index += 2;
    } else {
      previous = char;
      index++;
    }
  }
  return undefined;
}

function regexAllowed(previous: string): boolean {
  return previous === "keyword" || regexPunctuators.has(previous);
}

function findLineTerminator(text: string, start: number): number {
  for (let index = start; index < text.length; index++) {
    if (lineTerminator.test(text[index]!)) return index;
  }
  return -1;
}

/** Devuelve la posición siguiente a la comilla de cierre, o -1 si la cadena no termina en la línea. */
function skipString(text: string, start: number, quote: string): number {
  for (let index = start + 1; index < text.length; index++) {
    const char = text[index]!;
    // A line continuation may end in CRLF.
    if (char === "\\") index += text[index + 1] === "\r" && text[index + 2] === "\n" ? 2 : 1;
    else if (char === quote) return index + 1;
    else if (char === "\n" || char === "\r") return -1;
  }
  return -1;
}

/** Devuelve la posición siguiente al acento grave de cierre, incluidas sustituciones anidadas. */
function skipTemplate(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\") index += 2;
    else if (char === "`") return index + 1;
    else if (char === "$" && text[index + 1] === "{") {
      const end = scanCode(text, index + 2);
      if (!end) return -1;
      index = end.close + 1;
    } else index++;
  }
  return -1;
}

/** Devuelve la posición siguiente a una expresión regular literal, o -1 si no es válida en la línea. */
function skipRegex(text: string, start: number): number {
  let inClass = false;
  for (let index = start + 1; index < text.length; index++) {
    const char = text[index]!;
    if (char === "\\") index++;
    else if (lineTerminator.test(char)) return -1;
    else if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) {
      let end = index + 1;
      while (end < text.length && wordCharacter.test(text[end]!)) end++;
      return end;
    }
  }
  return -1;
}
