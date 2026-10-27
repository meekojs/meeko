import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: { adapter: "node" },
  document: {
    lang: "es",
    head: {
      // Runs while the browser parses <head>, before the first paint: it applies the stored theme
      // so a dark choice never flashes light. Hydration adopts it without running it again.
      script: [{ children: 'try{var t=localStorage.getItem("meeko-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}' }],
    },
  },
});
