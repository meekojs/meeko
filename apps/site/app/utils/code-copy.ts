/** Writes `text` to the clipboard, with a selection fallback where the Clipboard API is missing. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try {
    if (!document.execCommand("copy")) throw new Error("copy was rejected");
  } finally {
    area.remove();
  }
}

/** Shows `label` on the button for a moment. */
function flash(button: HTMLButtonElement, label: string): void {
  button.textContent = label;
  button.dataset.state = label === "Copiado" ? "done" : "error";
  window.setTimeout(() => {
    button.textContent = "Copiar";
    delete button.dataset.state;
  }, 1600);
}

/**
 * Click handler of an article with highlighted code: a click on the "Copiar" button of a block
 * copies its code. One delegated listener serves every block of the inserted HTML.
 */
export function copyCodeBlock(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>("button[data-copy]");
  const code = button?.closest(".code-block")?.querySelector("pre code")?.textContent;
  if (!button || code === undefined || code === null) return;
  copyText(code).then(() => flash(button, "Copiado"), () => flash(button, "Error"));
}
