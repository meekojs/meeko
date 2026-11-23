// The focus ring of the navigation: outward where the element has room around it, inward inside a row or a
// panel that clips its overflow, where an outer ring would be cut.

/** The ring outside the element. */
export const focusRing = 'ui:focus-visible:outline-(length:--ui-focus-ring-width) ui:focus-visible:outline-solid ui:focus-visible:outline-focus ui:focus-visible:outline-offset-(--ui-focus-ring-offset)'

/** The ring inside the element. */
export const focusRingInset = 'ui:focus-visible:outline-(length:--ui-focus-ring-width) ui:focus-visible:outline-solid ui:focus-visible:outline-focus ui:focus-visible:-outline-offset-(--ui-focus-ring-width)'
