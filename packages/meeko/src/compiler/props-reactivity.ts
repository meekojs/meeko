import ts from "@typescript/typescript6";

/** A read of `props` that runs once, so it misses later changes of the parent's props. */
export interface PropsReadOnce {
  /** Offset in the script content. */
  readonly start: number;
  readonly message: string;
}

/**
 * Reads of the props view that run once: in the top-level setup code, or directly in an `onMounted`
 * callback. With reactive props the child stays mounted when the parent changes a prop, so such a
 * read keeps the first value. Reads inside other functions (handlers, `computed`, `effect`) run
 * again and are fine, `untrack(() => props.x)` among them; so are calls of a function prop and
 * `signal(props.x)`, an explicit initial value.
 */
export function propsReadsOnce(file: ts.SourceFile, propsName: string): PropsReadOnce[] {
  const found: PropsReadOnce[] = [];
  const visit = (node: ts.Node, scope: "setup" | "mounted" | undefined): void => {
    if (ts.isFunctionLike(node)) {
      const call = node.parent;
      const mounted = scope === "setup" && ts.isCallExpression(call) && call.arguments[0] === node
        && ts.isIdentifier(call.expression) && call.expression.text === "onMounted";
      ts.forEachChild(node, (child) => visit(child, mounted ? "mounted" : undefined));
      return;
    }
    if (scope && ts.isIdentifier(node) && node.text === propsName) {
      const message = readOnceMessage(node, propsName, scope, file);
      if (message) found.push({ start: node.getStart(file), message });
    }
    ts.forEachChild(node, (child) => visit(child, scope));
  };
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
    visit(statement, "setup");
  }
  return found;
}

function readOnceMessage(node: ts.Identifier, propsName: string, scope: "setup" | "mounted", file: ts.SourceFile): string | undefined {
  const parent = node.parent;
  const fix = scope === "mounted"
    ? "léela en un effect(() => …) para reaccionar a sus cambios"
    : `léela donde se usa: {${propsName}.x} en la plantilla, computed(() => ${propsName}.x) o una función`;
  const when = scope === "mounted" ? "onMounted se ejecuta una sola vez" : "el setup se ejecuta una sola vez";
  if (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isObjectBindingPattern(parent.name)) {
    return `Desestructurar ${propsName} copia sus valores: ${when} y no se actualizarán cuando el padre cambie las props; ${fix}`;
  }
  if ((ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent)) && parent.expression === node) {
    return `Expandir ${propsName} copia sus valores: ${when} y no se actualizarán cuando el padre cambie las props; ${fix}`;
  }
  const access = (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node ? parent : undefined;
  if (!access) return undefined;
  const outer = access.parent;
  // Calling a function prop (an event callback) is not a copy of its value.
  if (ts.isCallExpression(outer) && outer.expression === access) return undefined;
  // signal(props.x) states that the prop is only the initial value.
  if (ts.isCallExpression(outer) && ts.isIdentifier(outer.expression) && outer.expression.text === "signal" && outer.arguments[0] === access) return undefined;
  const text = access.getText(file);
  const initial = scope === "setup" ? `. Si sólo quieres el valor inicial, usa signal(${text}) o untrack(() => ${text})` : "";
  return `${text} se lee una sola vez porque ${when}: no se actualizará cuando el padre cambie la prop; ${fix}${initial}`;
}
