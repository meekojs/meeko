/** The complete .meeko file rendered beside the live task filter on the home page. */
export function showcaseCode(labels: { first: string; second: string; all: string; pending: string }): string {
	return `<script server lang="ts">
export const tasks = [
  { id: 1, title: ${JSON.stringify(labels.first)}, done: true },
  { id: 2, title: ${JSON.stringify(labels.second)}, done: false },
]
</script>
<script lang="ts">
import { signal } from '@meekojs/meeko'
const pending = signal(false)
</script>
<template>
  <button on:click="() => pending.value = !pending.value">
    {pending.value ? ${JSON.stringify(labels.all)} : ${JSON.stringify(labels.pending)}}
  </button>
  <ul>
    <li each:of="pending.value ? tasks.filter((task) => !task.done) : tasks"
        each:as="task" each:key="task.id">{task.title}</li>
  </ul>
</template>`
}
