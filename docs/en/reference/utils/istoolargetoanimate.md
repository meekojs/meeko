---
title: isTooLargeToAnimate
group: utils
since: 1.8.0
description: Tells whether a document is too large to animate with a View Transition; navigations and withViewTransition already check it.
symbols:
  - "@meekojs/meeko#isTooLargeToAnimate"
related:
  - docs/framework.md#view-transitions-nativas
source-hash: 66642aeb60cebc286837dd8fc2af20fccfc2ceadae7fbd8fb6a49dfe4f182521
---

`isTooLargeToAnimate(target?)` tells whether a document has too many elements to animate with a View Transition. On a page of thousands of elements, on a high-density screen or a phone, each frame of the transition blocks the page for seconds. Above the limit, apply the change without animating.

Navigations with `viewTransitions` and `withViewTransition()` from `@meekojs/ui/runtime` already check it. Use it only if you call `document.startViewTransition()` yourself.

## Usage

```ts
import { isTooLargeToAnimate } from "@meekojs/meeko";

function change(update: () => void) {
  if (isTooLargeToAnimate()) return update();
  const transition = document.startViewTransition(() => {
    update();
    // The change may have brought in the large content: do not pay for its frames.
    if (isTooLargeToAnimate()) transition.skipTransition();
  });
}
```

## Details

- Today the limit is 4,000 elements in the whole document. The exact value is not a contract: it can change in any version.
- Check before starting and again inside the callback, because the change can bring in the large content. Calling `skipTransition()` at that point avoids the frames, and the change stays applied.
- Counting is cheap: under 1 ms on a document of 24,000 elements with the CPU limited to ×4.
- It only exists in the browser. Without an argument it reads the global `document`.
