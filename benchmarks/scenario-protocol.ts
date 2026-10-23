/** Escenarios medidos por el runner de cargas ampliadas. */
export type Scenario = "tree" | "list" | "navigation";

export interface ScenarioClient {
  hydrationMs: number;
  step(): Promise<void>;
  verify(): void;
}

declare global {
  interface Window {
    __meekoScenario?: ScenarioClient;
  }
}

/** Comprueba el DOM y la URL tras cada operación; no se incluye en la espera de Vue. */
export function assertScenario(root: Element, scenario: Scenario, step: number): void {
  if (scenario === "tree") {
    const button = root.querySelector('button[data-id="0-0"]');
    if (button?.textContent !== `0-0: ${step}` || root.querySelectorAll("button").length !== 128) {
      throw new Error(`Incorrect tree at step ${step}`);
    }
  } else if (scenario === "list") {
    const first = root.querySelector("li:first-child");
    const last = root.querySelector("li:last-child");
    const expectedFirst = (1000 - (step % 1000)) % 1000;
    const expectedLast = (expectedFirst + 999) % 1000;
    if (root.querySelectorAll("li").length !== 1000 || first?.getAttribute("data-id") !== String(expectedFirst)
      || first?.textContent !== `Row ${expectedFirst}` || last?.getAttribute("data-id") !== String(expectedLast)
      || last?.textContent !== `Row ${expectedLast}`) {
      throw new Error(`Incorrect list at step ${step}`);
    }
  } else {
    const expected = step % 3;
    const active = root.querySelector("section[data-view]");
    const names = ["Home", "Catalog", "Profile"];
    if (active?.getAttribute("data-view") !== String(expected)
      || active.querySelectorAll("p").length !== 40
      || active.querySelector("p:first-of-type")?.textContent !== `${names[expected]} 0`
      || active.querySelector("p:last-of-type")?.textContent !== `${names[expected]} 39`
      || (step > 0 && location.pathname !== `/navigation/${expected}`)) {
      throw new Error(`Incorrect navigation at step ${step}`);
    }
  }
}
