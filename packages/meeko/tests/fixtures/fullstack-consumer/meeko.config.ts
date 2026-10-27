import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  extends: ["./layers/base"],
  modules: [],
  imports: { serverDirs: [] },
});
