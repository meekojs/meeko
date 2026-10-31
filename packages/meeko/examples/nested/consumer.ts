import type { ComponentProps } from "./Parent.meeko";

import { hydrate, renderToString } from "./Parent.meeko";

const props: ComponentProps = { initial: "Hello" };
void renderToString(props);
declare const root: Element;
void hydrate(root, props);

// @ts-expect-error The public props contract rejects non-string initial values.
void renderToString({ initial: 42 });
