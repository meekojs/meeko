import { hydrate, renderToString } from "../counter/Counter.meeko";
import { hydrate as hydrateRegions, renderToString as renderRegions } from "../regions/Regions.meeko";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app root");

root.innerHTML = renderToString({ initial: 2 });
hydrate(root, { initial: 2 });

const regionRoot = document.querySelector("#regions");
if (!regionRoot) throw new Error("Missing #regions root");
regionRoot.innerHTML = renderRegions({ initial: "Alpha" });
hydrateRegions(regionRoot, { initial: "Alpha" });
