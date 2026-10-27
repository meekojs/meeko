import { href, type RouteRecord } from "@meekojs/meeko/framework";
import type { ComponentProps as UserPageProps } from "./pages/users/index.meeko";

// This file is checked by `meeko check` in the installed tarball consumer.
// It is not imported by a browser entry and therefore emits no runtime code.
const routes: readonly RouteRecord[] = [];

const users: Promise<{ id: string; name: string }> = api.users.get();
const byId: Promise<{ id: string; name: string }> = api.users({ id: "123" }).get();
// The deprecated 1.0 form keeps working during 1.x.
const legacyById: Promise<{ id: string; name: string }> = api.users.byId.get({ params: { id: "123" } });
const created: Promise<{ id: string; name: string }> = api.users.post({ body: { name: "Ada" } });
const rpcUser: Promise<{ id: string; name: string }> = rpc.users.get({ id: "123" });

const chat = useSocket("chat");
const unsubscribe: () => void = chat.on("message", (message) => {
  const text: string = message.text;
  void text;
});
const sent: Promise<void> = socket.chat.emit("message", { text: "Hola", roomId: "general" });
const userPath: string = href(routes, "/users/[id]", { params: { id: "123" } });
const userPageProps: UserPageProps = { params: {}, search: {}, data: { id: "123", name: "Ada" } };

// @ts-expect-error A packaged .meeko declaration preserves the nested component prop type.
const invalidUserPageProps: UserPageProps = { params: {}, search: {}, data: { id: "123", name: 123 } };

// @ts-expect-error API path params must be provided.
api.users({});
// @ts-expect-error The segment call already binds the path params.
api.users({ id: "123" }).get({ params: { id: "123" } });
// @ts-expect-error API path params must be provided.
api.users.byId.get();
// @ts-expect-error The POST body comes from the shared schema.
api.users.post({ body: { name: 123 } });
// @ts-expect-error RPC input comes from the shared schema.
rpc.users.get({ id: 123 });
// @ts-expect-error A channel cannot emit a server-to-client-only event or invalid payload.
socket.chat.emit("message", { text: 123, roomId: "general" });
// @ts-expect-error Unknown Socket events are excluded by the generated contract.
chat.on("missing", () => {});
// @ts-expect-error The generated route declaration requires id.
href(routes, "/users/[id]");
// @ts-expect-error A static route cannot accept path parameters.
href(routes, "/", { params: { id: "unexpected" } });
// @ts-expect-error Unknown routes are excluded by the generated route declaration.
href(routes, "/missing");

void [users, byId, legacyById, created, rpcUser, unsubscribe, sent, userPath, userPageProps, invalidUserPageProps];
