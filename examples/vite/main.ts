import { hydrate, renderToString } from "../counter/Counter.meeko";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app root");

root.innerHTML = renderToString({ initial: 2 });
hydrate(root, { initial: 2 });
