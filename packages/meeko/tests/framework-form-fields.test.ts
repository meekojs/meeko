import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { checkSource } from "../src/check.ts";
import { ClientError, useForm } from "../src/framework.ts";
import type { FormField, FormSubmission } from "../src/framework.ts";
import { createRoot, provideErrorHandler } from "../src/index.ts";
import type { ReadonlySignal, Signal } from "../src/index.ts";
import { linkRepositoryPackages, repositoryRoot, tempProject } from "./helpers/temp-project.ts";

type Issue = { readonly message: string; readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] };
type Result<O> = { readonly value: O; readonly issues?: undefined } | { readonly issues: readonly Issue[] };

/** A Standard Schema v1 written by hand, with the same shape as a Valibot schema. */
function schema<I, O = I>(validate: (value: I) => Result<O> | Promise<Result<O>>) {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "test",
      validate: (value: unknown) => validate(value as I),
      types: undefined as { readonly input: I; readonly output: O } | undefined,
    },
  };
}

type PasswordInput = { password: string; confirm: string };

/** As `v.forward(v.partialCheck([["password"], ["confirm"]], …), ["confirm"])`: the mismatch goes to `confirm`. */
const passwordInput = schema<PasswordInput>((input) => {
  const issues: Issue[] = [];
  if (input.password.length < 10) issues.push({ message: "Usa al menos 10 caracteres.", path: [{ key: "password" }] });
  if (input.password !== input.confirm) issues.push({ message: "Las contraseñas no coinciden.", path: [{ key: "confirm" }] });
  return issues.length ? { issues } : { value: input };
});

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function withObserver<T>(work: () => T): { value: T; reported: unknown[]; dispose: () => void } {
  const reported: unknown[] = [];
  let dispose!: () => void;
  const value = createRoot((release) => {
    dispose = release;
    provideErrorHandler((error) => { reported.push(error); });
    return work();
  });
  return { value, reported, dispose };
}

test("a change revalidates the other fields that already show a schema error", async () => {
  const form = useForm({ schema: passwordInput, initial: { password: "corta1", confirm: "contrasena123" }, submit: () => "ok" });
  assert.equal(await form.submit(), undefined);
  assert.deepEqual(form.errors.value, { password: "Usa al menos 10 caracteres.", confirm: "Las contraseñas no coinciden." });

  // The password changes: its own message goes, and so does the confirmation's, which read it.
  form.fields.password.value = "contrasena123";
  assert.deepEqual(form.errors.value, {});

  // A field without an error still waits for the next submission.
  form.fields.password.value = "otra-contrasena";
  assert.deepEqual(form.errors.value, {}, "the confirmation had no error, so it gets none before submitting");

  // The confirmation shows an error again only after a submission; changing the password updates it.
  assert.equal(await form.submit(), undefined);
  assert.deepEqual(form.errors.value, { confirm: "Las contraseñas no coinciden." });
  form.fields.password.value = "corta";
  assert.deepEqual(form.errors.value, { confirm: "Las contraseñas no coinciden." }, "the password gets no message before submitting");
  form.fields.confirm.value = "corta";
  assert.deepEqual(form.errors.value, {});
});

test("revalidation keeps the server messages of other fields and updates a schema message of the whole form", async () => {
  let fail = true;
  const form = useForm({
    schema: passwordInput,
    initial: { password: "contrasena123", confirm: "contrasena123" },
    submit: () => {
      if (fail) throw new ClientError("PASSWORD_REUSED", 409, "r1", [{ path: "password", message: "Ya usaste esa contraseña." }]);
      return "ok";
    },
  });
  assert.equal(await form.submit(), undefined);
  assert.deepEqual(form.errors.value, { password: "Ya usaste esa contraseña." });
  // Another field changes: the browser schema cannot clear the server's message.
  form.fields.confirm.value = "contrasena12";
  assert.deepEqual(form.errors.value, { password: "Ya usaste esa contraseña." });
  // The field itself changes: its server message goes, as in 1.4.
  form.fields.password.value = "contrasena12";
  assert.deepEqual(form.errors.value, {});
  fail = false;

  // An issue of the whole object (path "") is the form message, and it is revalidated as well.
  const whole = schema<PasswordInput>((input) => input.password === input.confirm ? { value: input } : { issues: [{ message: "Las contraseñas no coinciden." }] });
  const formLevel = useForm({ schema: whole, initial: { password: "a", confirm: "b" }, submit: () => "ok" });
  assert.equal(await formLevel.submit(), undefined);
  assert.equal(formLevel.error.value, "Las contraseñas no coinciden.");
  formLevel.fields.confirm.value = "a";
  assert.equal(formLevel.error.value, null);
  formLevel.fields.confirm.value = "c";
  assert.equal(formLevel.error.value, null, "a cleared form message waits for the next submission");
});

test("an asynchronous revalidation applies only its latest run and covers every changed field", async () => {
  const pending: Array<(result: Result<PasswordInput>) => void> = [];
  const asyncSchema = schema<PasswordInput>((input) => new Promise((resolve) => {
    pending.push(() => resolve(passwordInput["~standard"].validate(input) as Result<PasswordInput>));
  }));
  const form = useForm({ schema: asyncSchema, initial: { password: "corta1", confirm: "x" }, submit: () => "ok" });
  const submitting = form.submit();
  pending.shift()!({ issues: [] });
  assert.equal(await submitting, undefined);
  assert.deepEqual(form.errors.value, { password: "Usa al menos 10 caracteres.", confirm: "Las contraseñas no coinciden." });
  form.fields.password.value = "contrasena123";
  form.fields.confirm.value = "contrasena123";
  assert.equal(pending.length, 2);
  // The first run settles last: it is stale and does not apply.
  pending[1]!({ issues: [] });
  await flush();
  pending[0]!({ issues: [] });
  await flush();
  assert.deepEqual(form.errors.value, {});
});

test("commit moves the reference of dirty and reset without clearing submitted", async () => {
  const form = useForm({ initial: { name: "Ada", bio: "" }, submit: (values) => ({ ...values, name: values.name.trim() }) });
  form.fields.name.value = "  Grace ";
  assert.equal(form.dirty.value, true);
  const saved = await form.submit();
  assert.deepEqual(saved, { name: "Grace", bio: "" });
  form.commit({ name: saved!.name });
  assert.deepEqual([form.fields.name.value, form.dirty.value, form.submitted.value], ["Grace", false, true]);
  form.fields.bio.value = "Hola";
  assert.equal(form.dirty.value, true);
  form.reset();
  assert.deepEqual([form.fields.name.value, form.fields.bio.value, form.dirty.value], ["Grace", "", false], "reset returns to the committed values");
  assert.equal(form.submitted.value, false, "reset still clears submitted");

  // Without values, commit takes the current fields.
  form.fields.bio.value = "Nueva";
  form.commit();
  assert.equal(form.dirty.value, false);
  form.reset({ name: "Ada" });
  assert.deepEqual([form.fields.name.value, form.fields.bio.value], ["Ada", "Nueva"], "reset(values) merges over the committed values");
});

test("onSuccess runs after a successful submission with the result and the form", async () => {
  const seen: unknown[] = [];
  const { value: form, reported, dispose } = withObserver(() => useForm({
    initial: { name: "  Ada " },
    submit: (values) => ({ name: values.name.trim() }),
    onSuccess: (saved, current) => {
      seen.push(saved, current.submitted.value);
      current.commit({ name: saved.name });
    },
  }));
  form.fields.name.value = "  Grace ";
  await form.submit();
  assert.deepEqual(seen, [{ name: "Grace" }, true]);
  assert.deepEqual([form.fields.name.value, form.dirty.value, form.submitted.value], ["Grace", false, true]);
  assert.deepEqual(reported, []);

  // A failing onSuccess reaches the error observer and does not change the outcome.
  const broken = withObserver(() => useForm({ initial: { name: "" }, submit: () => 1, onSuccess: () => { throw new Error("after"); } }));
  assert.deepEqual(await broken.value.trySubmit(), { ok: true, result: 1 });
  assert.equal(broken.reported.length, 1);
  assert.equal(broken.value.submitted.value, true);
  dispose();
  broken.dispose();
});

test("trySubmit resolves a discriminated outcome; submit keeps resolving the result or undefined", async () => {
  let failure: unknown;
  const { value: form, dispose } = withObserver(() => useForm({
    schema: passwordInput,
    initial: { password: "corta", confirm: "corta" },
    submit: () => { if (failure) throw failure; return { id: "u1" }; },
    errorMessage: (cause) => cause instanceof ClientError ? `server:${cause.code}` : "network",
  }));
  const invalid = await form.trySubmit();
  assert.deepEqual(invalid, { ok: false, reason: "invalid", errors: { password: "Usa al menos 10 caracteres." }, error: null, failure: null });

  form.fields.password.value = "contrasena123";
  form.fields.confirm.value = "contrasena123";
  assert.deepEqual(await form.trySubmit(), { ok: true, result: { id: "u1" } });

  failure = new ClientError("EMAIL_TAKEN", 409, "r", [{ path: "password", message: "Ya existe." }]);
  const server = await form.trySubmit();
  assert.equal(server.ok, false);
  assert.equal(!server.ok && server.reason, "invalid");
  assert.deepEqual(!server.ok && server.reason === "invalid" ? [server.errors, server.failure] : [], [{ password: "Ya existe." }, failure]);

  failure = new ClientError("CONFLICT", 409);
  assert.deepEqual(await form.trySubmit(), { ok: false, reason: "error", error: "server:CONFLICT", failure });
  failure = new TypeError("Failed to fetch");
  const network = await form.trySubmit();
  assert.deepEqual(network, { ok: false, reason: "error", error: "network", failure });
  assert.equal(await form.submit(), undefined, "submit still resolves undefined on a failure");
  failure = undefined;
  assert.deepEqual(await form.submit(), { id: "u1" }, "and the result on success");

  // A second submission while one runs is skipped.
  let open!: () => void;
  const slow = useForm({ initial: { name: "" }, submit: () => new Promise<string>((resolve) => { open = () => resolve("done"); }) });
  const first = slow.trySubmit();
  assert.deepEqual(await slow.trySubmit(), { ok: false, reason: "skipped" });
  open();
  assert.deepEqual(await first, { ok: true, result: "done" });
  dispose();

  // The outcome narrows on ok and reason.
  const typed = useForm({ initial: { name: "" }, submit: () => ({ id: "x" }) });
  assert.equal(describe(await typed.trySubmit()), "x");
});

function describe(outcome: FormSubmission<{ id: string }>): string {
  if (outcome.ok) return outcome.result.id;
  if (outcome.reason === "error") return outcome.failure.message;
  if (outcome.reason === "invalid") return Object.keys(outcome.errors).join();
  // @ts-expect-error a skipped submission has no errors
  return String(outcome.errors);
}

test("form.field gives a typed signal, the error state and IDs for a field component", async () => {
  const form = useForm({ schema: passwordInput, initial: { password: "", confirm: "" }, submit: () => "ok" });
  const password = form.field("password");
  assert.equal(form.field("password"), password, "the same object for the same field");
  assert.equal(password.value, form.fields.password);
  assert.equal(password.name, "password");
  assert.match(password.id, /^m-[A-Za-z0-9_-]+-password$/);
  assert.equal(password.errorId, `${password.id}-error`);
  assert.equal(password.hintId, `${password.id}-hint`);
  assert.notEqual(form.field("confirm").id, password.id);
  assert.deepEqual([password.error.value, password.invalid.value, password.describedBy.value], [undefined, false, undefined]);
  await form.submit();
  assert.deepEqual([password.error.value, password.invalid.value, password.describedBy.value], ["Usa al menos 10 caracteres.", true, password.errorId]);
  assert.throws(() => (form.field as (name: string) => unknown)("nope"), /no field "nope"/);
  const other = useForm({ initial: { password: "" }, submit: () => {} });
  assert.notEqual(other.field("password").id, password.id, "two forms never share IDs");

  if (false) {
    const field: FormField<string> = form.field("password");
    const value: Signal<string> = field.value;
    const message: ReadonlySignal<string | undefined> = field.error;
    // @ts-expect-error only the fields of the form
    form.field("nope");
    const flag = useForm({ initial: { accepted: false }, submit: () => {} });
    const accepted: FormField<boolean> = flag.field("accepted");
    // @ts-expect-error the field keeps its type
    const wrong: FormField<string> = flag.field("accepted");
    void [value, message, accepted, wrong];
  }
});

test("focusInvalid focuses the first invalid control of the submitted form after the messages render", async () => {
  const browser = new HappyWindow({ url: "https://example.test/" });
  const globals = globalThis as { requestAnimationFrame?: unknown; document?: unknown };
  const previousFrame = globals.requestAnimationFrame;
  globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);
  try {
    const document = browser.document;
    document.body.innerHTML = `<form id="signup"><input name="name"><input id="email-control"><input name="password"><button>Enviar</button></form>`;
    const element = document.getElementById("signup")!;
    let failure: unknown;
    const form = useForm({
      schema: passwordInput,
      initial: { password: "corta", confirm: "corta" },
      submit: () => { if (failure) throw failure; return "ok"; },
      focusInvalid: true,
    });
    const event = new browser.Event("submit", { cancelable: true });
    Object.defineProperty(event, "currentTarget", { value: element });
    const outcome = await form.trySubmit(event as unknown as Event);
    assert.equal(outcome.ok, false);
    assert.notEqual(document.activeElement?.getAttribute("name"), "password", "the focus waits until the messages render");
    await flush();
    assert.equal(document.activeElement?.getAttribute("name"), "password");

    // A server issue focuses its field too, found by the ID of form.field.
    (document.activeElement as unknown as HTMLElement).blur();
    const confirm = form.field("confirm");
    element.querySelector("#email-control")!.id = confirm.id;
    form.fields.password.value = "contrasena123";
    form.fields.confirm.value = "contrasena123";
    failure = new ClientError("TAKEN", 409, "r", [{ path: "confirm", message: "No." }]);
    await form.trySubmit(event as unknown as Event);
    await flush();
    assert.equal(document.activeElement?.id, confirm.id);

    // A failure without issues moves nothing.
    (document.activeElement as unknown as HTMLElement).blur();
    failure = new ClientError("DOWN", 503);
    await form.trySubmit(event as unknown as Event);
    await flush();
    assert.equal(document.activeElement, document.body);
  } finally {
    globals.requestAnimationFrame = previousFrame;
    await browser.happyDOM.close();
  }
});

test("meeko check accepts the field component of docs/framework.md with field, with model and with neither, without MEEK101", { timeout: 180_000 }, async (context) => {
  const docs = await readFile(join(repositoryRoot, "..", "..", "docs", "framework.md"), "utf8");
  const section = docs.slice(docs.indexOf("**Un campo con `field` o con `model`.**"));
  const [component, usage] = [...section.matchAll(/```html\n([^]*?)```/g)].slice(0, 2).map((match) => match[1]!);
  assert.match(component!, /^<!-- app\/components\/AppTextField\.meeko -->/);
  assert.match(usage!, /bind:field="form\.field\('email'\)"/);
  const root = await tempProject(context, "form-field-component");
  await mkdir(join(root, "app", "components"), { recursive: true });
  await mkdir(join(root, "app", "pages"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await linkRepositoryPackages(root);
  const componentFile = join(root, "app", "components", "AppTextField.meeko");
  await writeFile(componentFile, component!);
  const page = `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nconst form = useForm({ initial: { email: "" }, submit: () => {} });\nconst query = signal("");\n</script>\n<template>${usage}</template>\n`;
  for (const [file, source] of [[componentFile, component!], [join(root, "app", "pages", "index.meeko"), page]] as const) {
    const diagnostics = await checkSource(source, file);
    assert.deepEqual(diagnostics, [], `${file}: ${JSON.stringify(diagnostics)}`);
  }
  // The form of the setup that the section warns about.
  const once = component!.replace("const value = computed(() => props.field?.value ?? model);", "const value = { value: props.field?.value ?? model };");
  assert.deepEqual((await checkSource(once, componentFile)).map((diagnostic) => diagnostic.code), ["MEEK101"]);
});
