import { hydrate, type ComponentProps } from "./Counter.generated.ts";

function readProps(value: unknown): ComponentProps {
  if (typeof value !== "object" || value === null || !("initial" in value)) throw new TypeError("Invalid server props");
  const initial = value.initial;
  if (typeof initial !== "number" || !Number.isFinite(initial)) throw new TypeError("Invalid initial value");
  return { initial };
}

const root = document.getElementById("app");
const payload = document.getElementById("meeko-props");
if (!root || !payload?.textContent) throw new Error("Missing SSR root or props");
const props: ComponentProps = readProps(JSON.parse(payload.textContent) as unknown);
hydrate(root, props);
