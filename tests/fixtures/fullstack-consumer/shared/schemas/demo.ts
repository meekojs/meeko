import * as v from "valibot";

export const userSchema = v.object({ id: v.string(), name: v.string() });
export const userParams = v.object({ id: v.string() });
export const createUserBody = v.object({ name: v.string() });
export const loginBody = v.object({ user: v.string() });
export const loginResult = v.object({ user: v.string(), csrfToken: v.string() });
export const chatInput = v.object({ text: v.string(), roomId: v.string() });
export const chatMessage = v.object({ text: v.string(), roomId: v.string() });
