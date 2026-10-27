import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: { adapter: "node" },
  document: {
    lang: "es",
    head: {
      link: [
        { rel: "icon", type: "image/png", sizes: "64x64", href: "/brand/favicon-64.png" },
        { rel: "apple-touch-icon", href: "/brand/apple-touch-icon.png" },
      ],
      meta: [
        { name: "theme-color", content: "#fffaf3", media: "(prefers-color-scheme: light)" },
        { name: "theme-color", content: "#16100e", media: "(prefers-color-scheme: dark)" },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "Meeko" },
        { property: "og:locale", content: "es_ES" },
        { property: "og:image", content: "https://meeko.diegootayza.com/brand/apple-touch-icon.png" },
      ],
      // Runs while the browser parses <head>, before the first paint: it applies the stored theme
      // so a dark choice never flashes light. Hydration adopts it without running it again.
      script: [{ children: 'try{var t=localStorage.getItem("meeko-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}' }],
    },
  },
});
