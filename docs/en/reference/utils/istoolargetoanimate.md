---
title: isTooLargeToAnimate
group: utils
since: 1.8.0
description: Tells whether a document is too large to animate with a View Transition; navigations and withViewTransition already check it.
symbols:
  - "@meekojs/meeko#isTooLargeToAnimate"
related:
  - docs/framework.md#view-transitions-nativas
source-hash: 1f058af3dd6c8eb3015330fb096c7411593e67bbd563a125595dd0e3f0a75bc5
---

`isTooLargeToAnimate(target?)` tells whether a document has too many elements to animate with a View Transition. On a page of thousands of elements, on a high-density screen or a phone, each frame of the transition blocks the page for seconds. Above the limit, apply the change without animating.

Navigations with `viewTransitions` and `withViewTransition()` from `@meekojs/ui/runtime` already check it. Use it only if you call `document.startViewTransition()` yourself.

## Usage

```ts
// app/utils/change.ts
import { isTooLargeToAnimate } from "@meekojs/meeko";

export function change(update: () => void) {
  if (isTooLargeToAnimate()) return update();
  const transition = document.startViewTransition(() => {
    update();
    // The change may have brought in the large content: do not pay for its frames.
    if (isTooLargeToAnimate()) transition.skipTransition();
  });
}
```

## Parameters

| Parameter | Type       | Default    | Description           |
| --------- | ---------- | ---------- | --------------------- |
| `target`  | `Document` | `document` | The document to count |

## Return value

`true` if the document is above the limit and the change should be applied without animating; `false` if it can animate.

## Examples

### Checking another document

```ts
// app/utils/frame.ts
import { isTooLargeToAnimate } from "@meekojs/meeko";

export function canAnimateFrame(frame: HTMLIFrameElement) {
  return frame.contentDocument !== null && !isTooLargeToAnimate(frame.contentDocument);
}
```

## Common mistakes

### Checking only before starting

The change can bring in the large content. The short page starts the transition and its frames are paid for with the long one.

```ts bad
if (!isTooLargeToAnimate()) document.startViewTransition(showLongPanel);
else showLongPanel();
```

Check inside the callback too and skip the animation. The change stays applied.

```ts good
import { isTooLargeToAnimate } from "@meekojs/meeko";

declare function showLongPanel(): void;

if (isTooLargeToAnimate()) showLongPanel();
else {
  const transition = document.startViewTransition(() => {
    showLongPanel();
    if (isTooLargeToAnimate()) transition.skipTransition();
  });
}
```

## Notes

- **Limit:** today it is 4,000 elements in the whole document. The exact value is not a contract: it can change in any version.
- **Performance:** counting is cheap. Under 1 ms at the median on a document of 24,000 elements with the CPU limited to ×4.
- **Server:** it only exists in the browser. Without an argument it reads the global `document`, so do not call it during the server render.
