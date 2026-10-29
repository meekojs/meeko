import type { TrustedHtml } from "@meekojs/meeko";

/**
 * What a line of the demo's `.meeko` does with its signals: `count` declares the signal,
 * `doubled` derives from it and `render` reads it in the template.
 */
export type DemoMark = "count" | "doubled" | "render";

/** A highlighted line of the demo's source, as the server tokenized it. */
export interface DemoLine {
  /** Shiki tokens of the line, with the colors of both themes as CSS variables. */
  readonly html: TrustedHtml;
  readonly mark?: DemoMark;
}

/** The component the home page runs: its source, highlighted line by line, and where it lives. */
export interface DemoSource {
  /** Path in the package, such as `examples/counter/Counter.meeko`. */
  readonly file: string;
  /** Its page on GitHub. */
  readonly url: string;
  readonly lines: readonly DemoLine[];
  /** 1-based lines of the `signal()` and `computed()` declarations, as DevTools reports them. */
  readonly countLine: number;
  readonly doubledLine: number;
}
