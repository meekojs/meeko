/** The UI module publishes one stylesheet; every value can be overridden by the application. */
export const uiCss = `
:root {
  --meeko-ui-accent: #285ac8;
  --meeko-ui-accent-hover: #1c49af;
  --meeko-ui-on-accent: #fff;
  --meeko-ui-surface: #fff;
  --meeko-ui-surface-hover: #f3f5f9;
  --meeko-ui-text: #18202d;
  --meeko-ui-muted: #5d6879;
  --meeko-ui-border: #b8c2d0;
  --meeko-ui-danger: #b42335;
  --meeko-ui-focus: #285ac8;
  --meeko-ui-radius: 0.625rem;
  --meeko-ui-font: system-ui, sans-serif;
}
:root[data-theme="dark"] {
  --meeko-ui-accent: #9ab9ff;
  --meeko-ui-accent-hover: #b5ccff;
  --meeko-ui-on-accent: #101827;
  --meeko-ui-surface: #1c2330;
  --meeko-ui-surface-hover: #293242;
  --meeko-ui-text: #f0f3f8;
  --meeko-ui-muted: #b4bfce;
  --meeko-ui-border: #69778c;
  --meeko-ui-danger: #ffa0a9;
  --meeko-ui-focus: #9ab9ff;
}
.meeko-ui-button, .meeko-ui-input, .meeko-ui-field,
[data-meeko-select], [data-meeko-popover], [data-meeko-theme-toggle] {
  font-family: var(--meeko-ui-font);
}
.meeko-ui-button {
  align-items: center;
  display: inline-flex;
  justify-content: center;
  min-height: 2.5rem;
  padding: 0.55rem 0.9rem;
  border: 1px solid transparent;
  border-radius: var(--meeko-ui-radius);
  background: var(--meeko-ui-accent);
  color: var(--meeko-ui-on-accent);
  font: 600 0.9rem/1.2 var(--meeko-ui-font);
  cursor: pointer;
}
.meeko-ui-button:hover:not(:disabled) { background: var(--meeko-ui-accent-hover); }
.meeko-ui-button[data-variant="secondary"] {
  border-color: var(--meeko-ui-border);
  background: var(--meeko-ui-surface);
  color: var(--meeko-ui-text);
}
.meeko-ui-button[data-variant="secondary"]:hover:not(:disabled) { background: var(--meeko-ui-surface-hover); }
.meeko-ui-button:disabled, .meeko-ui-input:disabled, [data-meeko-select][data-disabled] { opacity: 0.55; cursor: not-allowed; }
.meeko-ui-input, [data-meeko-select-trigger] {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: 2.5rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--meeko-ui-border);
  border-radius: var(--meeko-ui-radius);
  background: var(--meeko-ui-surface);
  color: var(--meeko-ui-text);
  font: 400 0.9rem/1.3 var(--meeko-ui-font);
}
[data-meeko-select-trigger] { text-align: start; cursor: pointer; }
.meeko-ui-input::placeholder, [data-meeko-select-placeholder] { color: var(--meeko-ui-muted); }
.meeko-ui-input[aria-invalid="true"], [data-meeko-select-trigger][aria-invalid="true"] { border-color: var(--meeko-ui-danger); }
.meeko-ui-button:focus-visible, .meeko-ui-input:focus-visible,
[data-meeko-select-trigger]:focus-visible, [data-meeko-popover-trigger]:focus-visible,
[data-meeko-theme-toggle] button:focus-visible {
  outline: 2px solid var(--meeko-ui-focus);
  outline-offset: 2px;
}
.meeko-ui-field { display: grid; gap: 0.4rem; color: var(--meeko-ui-text); }
.meeko-ui-field-label { font-size: 0.875rem; font-weight: 600; }
.meeko-ui-field-description { margin: 0; color: var(--meeko-ui-muted); font-size: 0.8125rem; }
.meeko-ui-field-error { margin: 0; color: var(--meeko-ui-danger); font-size: 0.8125rem; }
[data-meeko-popover] {
  max-height: min(20rem, 70vh);
  overflow: auto;
  padding: 0.35rem;
  border: 1px solid var(--meeko-ui-border);
  border-radius: var(--meeko-ui-radius);
  background: var(--meeko-ui-surface);
  color: var(--meeko-ui-text);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.16);
}
[data-meeko-select-list] [role="option"] { padding: 0.5rem 0.65rem; border-radius: calc(var(--meeko-ui-radius) - 0.2rem); cursor: pointer; }
[data-meeko-select-list] [role="option"][data-active] { background: var(--meeko-ui-surface-hover); }
[data-meeko-select-list] [role="option"][data-selected] { font-weight: 600; }
[data-meeko-select-list] [role="option"][data-disabled] { opacity: 0.55; cursor: not-allowed; }
[data-meeko-select-group-label], [data-meeko-select-empty], [data-meeko-select-loading] { padding: 0.5rem 0.65rem; color: var(--meeko-ui-muted); font-size: 0.8125rem; }
[data-meeko-theme-toggle] button {
  min-height: 2.5rem;
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--meeko-ui-border);
  border-radius: var(--meeko-ui-radius);
  background: var(--meeko-ui-surface);
  color: var(--meeko-ui-text);
  cursor: pointer;
}
[data-meeko-theme-toggle] button:hover { background: var(--meeko-ui-surface-hover); }
`
