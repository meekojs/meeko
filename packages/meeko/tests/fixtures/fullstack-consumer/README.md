# Meeko framework starter

Requires Node 24.

```sh
npm install
npm run dev
```

Routes live in `app/pages`. `app/layouts/default.meeko` keeps the shared shell during client navigation. `server/runtime.ts` creates the sessions: memory in development, SQLite in production. Run `npm run build` and `npm start` for production SSR; the build in `.meeko/output/node` runs without the application sources. Generated files live under `.meeko/`.
