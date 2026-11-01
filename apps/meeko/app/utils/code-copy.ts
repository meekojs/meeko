import { useI18n } from "@meekojs/i18n";

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

/** What the button of a code block says after a copy; the render already wrote its "Copy" label in the page's language. */
export interface CodeCopyLabels {
  readonly done: string;
  readonly failed: string;
}

/** Shows `label` on the button for a moment, then its own label again. */
function flash(button: HTMLButtonElement, label: string, state: "done" | "error"): void {
  const idle = button.dataset.label ?? button.textContent ?? "";
  button.dataset.label = idle;
  button.textContent = label;
  button.dataset.state = state;
  window.setTimeout(() => {
    button.textContent = idle;
    delete button.dataset.state;
  }, 1600);
}

/**
 * Click handler of an article with highlighted code: a click on the copy button of a block copies
 * its code. One delegated listener serves every block of the inserted HTML.
 */
export function copyCodeBlock(event: MouseEvent, labels: CodeCopyLabels): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>("button[data-copy]");
  const code = button?.closest(".code-block")?.querySelector("pre code")?.textContent;
  if (!button || code === undefined || code === null) return;
  copyText(code).then(() => flash(button, labels.done, "done"), () => flash(button, labels.failed, "error"));
}

/** {@link copyCodeBlock} with the labels of the page's language, for `on:click` of an article. */
export function useCodeCopy(): (event: MouseEvent) => void {
  const { t } = useI18n();
  const labels: CodeCopyLabels = { done: t("actions.copied"), failed: t("actions.copyFailed") };
  return (event) => copyCodeBlock(event, labels);
}
