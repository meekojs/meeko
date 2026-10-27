interface ChromeDevtoolsPanel {
  onShown: { addListener(listener: (window: Window) => void): void };
  onHidden: { addListener(listener: () => void): void };
}

declare const chrome: {
  devtools: {
    panels: {
      create(title: string, iconPath: string, pagePath: string, callback?: (panel: ChromeDevtoolsPanel) => void): void;
    };
    inspectedWindow: {
      eval(expression: string, callback: (result: unknown, exceptionInfo?: { isError?: boolean; value?: string; description?: string }) => void): void;
    };
  };
};
