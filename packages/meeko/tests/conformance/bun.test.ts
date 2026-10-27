import { conformanceSuite } from "./assertions.ts";

// Skipped with a message when `bun` (or MEEKO_BUN) is unavailable, unless
// MEEKO_CONFORMANCE_REQUIRE lists bun.
conformanceSuite("bun");
