/// <reference types="vite/client" />

import { hydrate, renderToString } from "../counter/Counter.meeko";
import { hydrate as hydrateRegions, renderToString as renderRegions } from "../regions/Regions.meeko";
import { hydrate as hydrateHot, renderToString as renderHot } from "./Hot.meeko";
import { hydrate as hydrateNested, renderToString as renderNested } from "../nested/Parent.meeko";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app root");

root.innerHTML = renderToString({ initial: 2 });
hydrate(root, { initial: 2 });

const regionRoot = document.querySelector("#regions");
if (!regionRoot) throw new Error("Missing #regions root");
regionRoot.innerHTML = renderRegions({ initial: "Alpha" });
hydrateRegions(regionRoot, { initial: "Alpha" });

const hotRoot = document.querySelector("#hot");
if (!hotRoot) throw new Error("Missing #hot root");
hotRoot.innerHTML = renderHot({});
hydrateHot(hotRoot, {});

const nestedRoot = document.querySelector("#nested");
if (!nestedRoot) throw new Error("Missing #nested root");
nestedRoot.innerHTML = renderNested({ initial: "Root" });
hydrateNested(nestedRoot, { initial: "Root" });

if (import.meta.env.DEV) {
  void import("@meekojs/meeko/devtools-ui").then(({ mountDevtoolsPanel }) => {
    mountDevtoolsPanel();
  });
}
