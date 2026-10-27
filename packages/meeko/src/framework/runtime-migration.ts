import { existsSync } from "node:fs";
import { resolve } from "node:path";

const legacyFiles = ["server/session.ts", "server/session.mts", "server/session.js", "server/session.mjs"];

/** Meeko no longer loads `server/session.ts`; fail with the migration instead of ignoring it. */
export function assertNoLegacySessionFile(projectRoot: string): void {
  const file = legacyFiles.map((name) => resolve(projectRoot, name)).find((candidate) => existsSync(candidate));
  if (!file) return;
  throw new Error([
    `${file}: Meeko no longer loads server/session.ts.`,
    "Move its SessionManager into server/runtime.ts and delete server/session.ts:",
    "",
    '  import { defineServerRuntime } from "@meekojs/meeko/server";',
    "",
    "  export default defineServerRuntime(({ production }) => ({",
    "    sessions: /* the SessionManager that createSessionManager(production) returned */,",
    "    services: (request) => ({ /* per-request services */ }),",
    "  }));",
    "",
    "server/runtime.ts also declares services, publicOrigin, Socket options, onError and close.",
  ].join("\n"));
}
