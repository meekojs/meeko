import { defineMeekoConfig } from "@meekojs/meeko/framework";

/** Features the site does not use; copying a code block writes to the clipboard. */
const permissions = [
  "accelerometer=()", "autoplay=()", "camera=()", "clipboard-read=()", "clipboard-write=(self)",
  "display-capture=()", "encrypted-media=()", "fullscreen=()", "geolocation=()", "gyroscope=()",
  "hid=()", "idle-detection=()", "magnetometer=()", "microphone=()", "midi=()", "payment=()",
  "picture-in-picture=()", "publickey-credentials-get=()", "screen-wake-lock=()", "serial=()",
  "usb=()", "xr-spatial-tracking=()",
].join(", ");

export default defineMeekoConfig({
  // Canonical URLs, og:url, sitemap.xml and robots.txt use this origin.
  site: "https://meeko.diegootayza.com",
  sitemap: true,
  robots: true,
  // Light, dark or the system's, in the cookie and localStorage "meeko-theme" (the key the site
  // used before, so earlier choices still apply). Dark until the visitor chooses. Every page is
  // prerendered, so Meeko's inline script in <head> applies the stored theme before the first
  // paint, and the ThemeToggle of the layout (useTheme) follows it.
  theme: { default: "dark" },
  // Every page is prerendered: the build is a folder of files for nginx (deploy/nginx.conf).
  server: {
    adapter: "static",
    // _meeko/headers.conf, which deploy/nginx.conf includes in every location.
    headerFiles: ["nginx"],
    // No inline script runs without its SHA-256, which the build adds to script-src on every
    // build (the theme script of `theme`, for example): changing a script needs no manual step.
    //
    // - script-src 'wasm-unsafe-eval': Pagefind compiles its WebAssembly search engine, in its
    //   worker and in the page. It allows compiling WebAssembly, not `eval` or `new Function`.
    // - style-src 'unsafe-inline': Meeko writes each component's styles in a <style> element, in
    //   the document and on client navigation, and Shiki colors code with `style` attributes, also
    //   in HTML that the client inserts. Hashes would have to cover every attribute value
    //   ('unsafe-hashes') and every style a navigation brings. Inline CSS runs no code, and with
    //   img-src, font-src and connect-src limited to 'self' it cannot send data elsewhere.
    // - No `upgrade-insecure-requests`: every resource is same-origin and relative, so on HTTPS it
    //   changes nothing, and over plain HTTP (a local preview) it would break the site.
    // - No `require-trusted-types-for 'script'`: the `html` directive of Meeko and the Pagefind
    //   excerpts assign HTML strings to `innerHTML` without a Trusted Types policy.
    contentSecurityPolicy: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'wasm-unsafe-eval'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'"],
      "font-src": ["'self'"],
      // Client navigation (each page's index.meeko.json) and the Pagefind index and WebAssembly.
      "connect-src": ["'self'"],
      "worker-src": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      "frame-ancestors": ["'none'"],
      "form-action": ["'self'"],
    },
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": permissions,
    },
  },
  document: {
    lang: "es",
    // The canonical URL and og:url of each page, and og:title and og:description from its title
    // and description; the 404 page gets no address of its own.
    seo: true,
    head: {
      link: [
        // Inter, self-hosted (app/styles/tokens.css): preloaded so the first paint already uses it.
        { rel: "preload", href: "/fonts/inter-latin-opsz-normal.woff2", as: "font", type: "font/woff2", crossorigin: "anonymous" },
        { rel: "icon", type: "image/png", sizes: "64x64", href: "/brand/favicon-64.png" },
        { rel: "apple-touch-icon", href: "/brand/apple-touch-icon.png" },
      ],
      meta: [
        { name: "theme-color", content: "#0a0b0d" },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "Meeko" },
        { property: "og:locale", content: "es_ES" },
        { property: "og:image", content: "https://meeko.diegootayza.com/brand/apple-touch-icon.png" },
      ],
    },
  },
});
