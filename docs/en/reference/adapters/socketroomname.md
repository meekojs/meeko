---
title: socketRoomName
group: adapters
since: 1.0.0
description: The Durable Object name of a Socket room in Cloudflare Workers, with one object per channel and room, for idFromName.
symbols:
  - "@meekojs/meeko/cloudflare#socketRoomName"
related:
  - "@meekojs/meeko/cloudflare#createSocketRoomClass"
  - "@meekojs/meeko/cloudflare#DurableObjectSocketPubSub"
  - "@meekojs/meeko/cloudflare#createWorker"
  - docs/framework.md#socket-y-durable-objects
source-hash: 7edaf65a6a9a4915281f993de97c7f4647774b2a9439c5cb83ea28396b5db60a
---

`socketRoomName(channel, room)` returns the name Meeko uses to locate a room's Durable Object: the channel and room separated by a null character (`"chat\u0000general"`). It is used by `createWorker` when forwarding an upgrade, by `DurableObjectSocketPubSub` when publishing and by the room itself to recognize publications addressed to it.

Use it in a custom Worker that needs to communicate with a specific room: inspect it, publish without going through the hub or forward an upgrade.

## Usage

<!-- no-check -->

```ts
import { socketRoomName } from "@meekojs/meeko/cloudflare";

const stub = env.MEEKO_SOCKET.get(env.MEEKO_SOCKET.idFromName(socketRoomName("chat", "general")));
```

## Parameters

| Parameter | Type     | Description                                                  |
| --------- | -------- | ------------------------------------------------------------ |
| `channel` | `string` | The channel, the filename in `server/socket/`.               |
| `room`    | `string` | The room from `?room=`; connections without a room use `""`. |

## Return value

`` `${channel}\0${room}` ``. The null separator cannot appear in a channel name, so two distinct pairs never share an object.

## Examples

### The name of each pair

```ts
import { socketRoomName } from "@meekojs/meeko/cloudflare";

console.log(JSON.stringify(socketRoomName("chat", "general"))); // "chat\u0000general"
console.log(JSON.stringify(socketRoomName("operations", "")));  // "operations\u0000", the default room
```

### Publish to a room from a Cron Trigger

<!-- no-check -->

```ts
// worker.ts: a scheduled event rather than an HTTP request.
import { DurableObjectSocketPubSub } from "@meekojs/meeko/cloudflare";

export default {
  fetch: worker.fetch,
  async scheduled(_event: ScheduledEvent, env: Env) {
    const pubsub = new DurableObjectSocketPubSub(env.MEEKO_SOCKET);
    await pubsub.publish("status", "", { event: "maintenance", payload: { at: Date.now() } });
  },
};
```

`DurableObjectSocketPubSub` computes the name with `socketRoomName`. Publishing this way does not validate the event or payload before sending them (the room discards a payload that fails the schema when delivering it); within a request, prefer `socket.status.broadcast("", "maintenance", payload)`, which validates them against the contract.

## Common mistakes

### Build the name by hand

```ts bad
env.MEEKO_SOCKET.idFromName(`${channel}:${room}`);
```

There is no error, but this is a different object: empty, without the room's peers. The publications reach nobody.

<!-- no-check -->

```ts good
env.MEEKO_SOCKET.idFromName(socketRoomName(channel, room));
```

## Notes

- **Long names.** If the name exceeds 1,024 bytes, the runtime does not expose `ctx.id.name`: the room takes it from its first connection or publication.
- **Stability.** Deployed rooms are located by this name: a custom Worker that computes it differently communicates with empty objects.
