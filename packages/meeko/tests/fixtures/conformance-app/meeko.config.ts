import { defineMeekoConfig } from "@meekojs/meeko/framework";

// Bun and Deno build this configuration with --adapter; Workers write their own with the same policy.
export default defineMeekoConfig({
  server: {
    adapter: "node",
    contentSecurityPolicy: { "default-src": ["'self'"], "script-src": ["'self'"], "style-src": ["'self'", "'unsafe-inline'"], "object-src": ["'none'"] },
    headers: { "X-Content-Type-Options": "nosniff", "/api/*": { "X-Robots-Tag": "none" } },
  },
});
