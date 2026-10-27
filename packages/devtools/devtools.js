// @ts-check

/** Registra el panel propio y suspende el sondeo cuando deja de estar visible. */
chrome.devtools.panels.create("Meeko", "meeko-logo.png", "panel.html", (panel) => {
  document.documentElement.dataset.meekoPanelRegistered = "true";
  /** @type {Window | undefined} */
  let panelWindow;
  panel.onShown.addListener((shown) => {
    panelWindow = shown;
    shown.postMessage({ source: "meeko-devtools", visible: true }, shown.location.origin);
  });
  panel.onHidden.addListener(() => {
    panelWindow?.postMessage({ source: "meeko-devtools", visible: false }, panelWindow.location.origin);
  });
});
