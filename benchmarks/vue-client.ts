import { createSSRApp, nextTick } from "vue";
import { VueCounter } from "./vue-counter.js";

declare global {
  interface Window {
    __meekoBenchmark?: {
      hydrationMs: number;
      step: () => Promise<void>;
    };
  }
}

const root = document.getElementById("app");
if (!root) throw new Error("Missing benchmark root");
const started = performance.now();
createSSRApp(VueCounter, { initial: 0 }).mount(root);
const hydrationMs = performance.now() - started;
const button = root.querySelector("button");
if (!button) throw new Error("Missing benchmark button");
let expected = 0;

window.__meekoBenchmark = {
  hydrationMs,
  async step() {
    button.click();
    await nextTick();
    expected++;
    if (button.textContent !== `${expected} · doble: ${expected * 2}`) {
      throw new Error(`Incorrect Vue update at ${expected}`);
    }
  },
};
