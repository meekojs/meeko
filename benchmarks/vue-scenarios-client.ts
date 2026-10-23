import { createSSRApp } from "vue";
import { VueList, VueNavigation, VueTree, nextTick } from "./vue-scenarios.js";
import { assertScenario, type Scenario } from "./scenario-protocol.js";

const root = document.getElementById("app");
if (!root) throw new Error("Missing benchmark root");
const scenario = new URL(location.href).searchParams.get("scenario") as Scenario;
if (scenario !== "tree" && scenario !== "list" && scenario !== "navigation") throw new Error("Invalid scenario");
const component = scenario === "tree" ? VueTree : scenario === "list" ? VueList : VueNavigation;
const started = performance.now();
createSSRApp(component).mount(root);
const hydrationMs = performance.now() - started;
const button = root.querySelector<HTMLButtonElement>(scenario === "tree" ? 'button[data-id="0-0"]' : "button");
if (!button) throw new Error("Missing scenario action");
let step = 0;
assertScenario(root, scenario, step);

window.__meekoScenario = {
  hydrationMs,
  async step() {
    button.click();
    await nextTick();
    step++;
  },
  verify() {
    assertScenario(root, scenario, step);
  },
};
