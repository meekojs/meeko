import { hydrate as hydrateTree } from "./cases/Tree.generated.ts";
import { hydrate as hydrateList } from "./cases/List.generated.ts";
import { hydrate as hydrateNavigation } from "./cases/Navigation.generated.ts";
import { assertScenario, type Scenario } from "./scenario-protocol.js";

const root = document.getElementById("app");
if (!root) throw new Error("Missing benchmark root");
const scenario = new URL(location.href).searchParams.get("scenario") as Scenario;
if (scenario !== "tree" && scenario !== "list" && scenario !== "navigation" && scenario !== "navigation-mount") throw new Error("Invalid scenario");
const started = performance.now();
if (scenario === "tree") hydrateTree(root, {});
else if (scenario === "list") hydrateList(root, {});
else hydrateNavigation(root, { mode: scenario === "navigation" ? "reuse" : "mount" });
const hydrationMs = performance.now() - started;
const button = root.querySelector<HTMLButtonElement>(scenario === "tree" ? 'button[data-id="0-0"]' : "button");
if (!button) throw new Error("Missing scenario action");
let step = 0;
assertScenario(root, scenario, step);
let previousView = root.querySelector("section[data-view]");

window.__meekoScenario = {
  hydrationMs,
  async step() {
    button.click();
    step++;
  },
  verify() {
    assertScenario(root, scenario, step, previousView);
    previousView = root.querySelector("section[data-view]");
  },
};
