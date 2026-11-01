// A job that never ends by itself: it prints its pid and waits. It uses the guard of the real jobs
// (scripts/parent-guard.mjs), so it ends when the dashboard that started it dies; with
// FIXTURE_UNGUARDED=1 it does not, to show what the guard prevents.
import { exitWithParent } from '../../scripts/parent-guard.mjs'

if (process.env.FIXTURE_UNGUARDED !== '1') exitWithParent({ keepAlive: true })
console.log(`pid:${process.pid}`)
setTimeout(() => {}, 120_000)
