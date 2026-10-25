import { conformanceSuite } from "./assertions.ts";

// Skipped with a message when `deno` (or MEEKO_DENO) is unavailable, unless
// MEEKO_CONFORMANCE_REQUIRE lists deno.
conformanceSuite("deno");
