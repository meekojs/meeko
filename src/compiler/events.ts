const typedEvents = new Set(["click", "input", "change", "submit", "keydown", "keyup", "focus", "blur"]);

/** Keeps CLI and editor callback contracts aligned for template events. */
export function templateEventType(name: string): string {
  return typedEvents.has(name) ? `GlobalEventHandlersEventMap[${JSON.stringify(name)}]` : "Event";
}
