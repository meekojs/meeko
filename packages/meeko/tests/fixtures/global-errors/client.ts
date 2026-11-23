import { mountClientApp } from "../../../src/app/runtime/client.ts";
import { page, routes } from "./page.ts";

interface Report { readonly message: string; readonly source: string }

declare global {
  interface Window { __reports: Report[]; __lastReported: unknown; __repeatFinished?: boolean; __ready: boolean }
}

window.__reports = [];
const app = await mountClientApp({
  routes,
  root: document.getElementById("app")!,
  payload: document.getElementById("meeko-payload")?.textContent,
  loadPage: async () => page,
  onError(error, source) {
    window.__lastReported = error;
    window.__reports.push({ message: error instanceof Error ? error.message : String(error), source });
  },
});

// Failures of code that never passes through Meeko: a timer and a promise chain without catch.
document.getElementById("timer")!.addEventListener("click", () => {
  setTimeout(() => { throw new Error("timer failure"); }, 0);
});
document.getElementById("reject")!.addEventListener("click", () => {
  void Promise.resolve().then(() => { throw new Error("rejected failure"); });
});
// The app throws again a failure that the observer already received: no second report.
document.getElementById("reported")!.addEventListener("click", () => {
  const again = window.__lastReported;
  setTimeout(() => {
    // The next task runs after the browser has dispatched the error from this one.
    setTimeout(() => { window.__repeatFinished = true; }, 0);
    throw again;
  }, 0);
});
document.getElementById("dispose")!.addEventListener("click", () => {
  app.dispose();
  setTimeout(() => { throw new Error("after dispose"); }, 0);
});
window.__ready = true;
