# Translating the Meeko documentation

This guide coordinates translation of the Spanish Markdown under `docs/` into English under `docs/en/`. Use [the glossary](GLOSSARY.md) for terminology and reference headings. This task creates translation guidance and assignments only; it does not translate the assigned pages.

## Scope and source of truth

Preserve source-relative paths, folders and filenames: `docs/framework.md` becomes `docs/en/framework.md`, and `docs/reference/reactivity/signal.md` becomes `docs/en/reference/reactivity/signal.md`. Do not rename Spanish slugs such as `primeros-pasos.md` or `como-elegir.md`. Translate visible titles and prose, not file identifiers.

Each translator owns only the destination files in their batch. Do not change the Spanish sources, taxonomy, package code, generated files or another translator's files. Record a source revision before starting; if the source changes, reconcile it before handing the translation back. Preserve behavior, supported environments, version numbers, limitations and security warnings exactly in meaning. Report a source error to the coordinator rather than silently correcting it in translation.

## Code and literal text

Copy fenced code blocks unchanged, including comments, string literals, example data, paths, indentation, language labels and fence metadata. Preserve inline identifiers, macros, type names, configuration values, URLs, diagnostic codes and quoted diagnostic output. Translate surrounding explanations, link labels, table prose and image alternative text where they are natural language.

Translating explanatory comments is common in technical documentation. This first pass deliberately keeps all code comments in Spanish: the reference test compiles non-`bad` TypeScript blocks, and the same blocks can contain file markers, compiler directives, expected diagnostics or text used by checks. Keeping complete blocks identical provides a simple, reviewable guarantee that translation has not changed an example. Explain a Spanish comment in the surrounding English prose if needed. Any later comment-only localization should be a separate, coordinated pass that identifies compiled examples and reruns their checks.

Keep `bad` and `good` fence metadata, `<!-- no-check -->`, GitHub alert markers such as `[!WARNING]`, and HTML/Markdown control comments unchanged. Translate the prose inside an alert. Do not replace error messages with invented English runtime output: retain the actual message and explain it in English.

## Links and anchors

Documentation link destinations are the controlled exception to preserving paths. Retarget links to translated pages and translate their fragments to the exact anchor produced by the English heading. For example, the repository-root documentation destination `docs/framework.md#crear-una-aplicación` becomes `docs/en/framework.md#create-an-application` if its destination heading is “Create an application”. Do not guess fragments from the Spanish slug.

Maintain the source link convention. In repository-root body link destinations use `docs/en/...`; keep frontmatter `related` entries identical to the source. In ordinary relative links, resolve from the translated file's folder: a link from `docs/en/api.md` to `docs/en/framework.md` can stay `framework.md#...`; prefixing it with `docs/en/` would point to the wrong directory. Translate same-page `#fragment` links too. Keep reference group folders and symbol slugs unchanged.

Do not rewrite external URLs, API symbol IDs or paths inside code. For links to repository files outside the translated tree (for example `../SECURITY.md` in a root guide), recalculate the relative path from the deeper destination (`../../SECURITY.md`), while preserving the actual target. Check Markdown links, reference-style link definitions, images and frontmatter `related` links.

The definitive i18n-content-db specification confirms English public URLs as `/en/docs/<same slug>`: a body link such as `/docs/reference/useform` becomes `/en/docs/reference/useform`. Keep slugs unchanged. Record unresolved links to untranslated pages at handoff, then resolve them during integration. A translator should not declare all links validated while another batch is still missing.

## Reference frontmatter

Preserve frontmatter keys, value types and order where practical. Keep `title` when it is an API/syntax/command identifier, and retain `group`, `since`, `symbols`, `types` and `signature` exactly, including symbol order and `signature: first`. Translate `description` into one line without links. Keep every `related` entry identical to the Spanish source, including documentation paths and heading fragments. The renderer resolves these against the English guide. Do not translate taxonomy group IDs or version strings.

The definitive translation format is specified in [the “Idiomas” section of the `meeko-docs-content` README](../../packages/docs-content/README.md#idiomas). That specification takes precedence over this guide.

Append this final frontmatter key to every translated reference page:

```yaml
source-hash: <hex>
```

`<hex>` is the lowercase SHA-256 of the complete Spanish source, with CRLF line endings normalized to LF. Preserve the original frontmatter keys and order; translate only `description` and prose `title` values. Keep `group`, `since`, `symbols`, `types`, `signature` and `related` identical. For a guide without source frontmatter, add frontmatter containing only `source-hash`. These two contributor documents are not translations and need no provenance marker. English pages require the coordinator's locale-aware metadata parsing and rendering integration.

## Reference body structure and validation gap

Begin with the translated introduction without a heading. Then use exactly six written `##` sections, in this order:

1. Usage
2. Parameters, Props, Options or Attributes (one of these)
3. Return value or Result (one of these)
4. Examples
5. Common mistakes
6. Notes

Do not write Type or Related sections: the site generates them. Keep examples under `###`; every `###` mistake needs an incorrect `bad` block and a corrected `good` block. Retain all existing examples and compiler-check exclusions.

The current validator in `apps/meeko/tests/reference.test.mjs` reads Spanish `pageSections` from `packages/docs-content/src/content/reference.ts` and also finds `Errores comunes` and `Ejemplos` by literal name. It does not yet validate English headings. The renderer's generated labels and metadata parser also need locale support. The coordinator owns these integration changes; translators must not keep Spanish headings merely to satisfy the old validator or modify tests in their batches. A passing Spanish reference suite does not prove the English pages are integrated.

## Translator workflow

1. Read the source page, glossary and any linked section necessary to understand the terminology. Note its source revision.
2. Create only its matching English path. Copy code blocks and structural metadata before translating prose.
3. Translate headings, descriptions, explanations, tables and accessible text using sentence case and “you”. Preserve all technical qualifications.
4. Update documentation links and record each cross-batch anchor that cannot yet be checked. Add the definitive `source-hash` computed from the Spanish source.
5. Compare code blocks with the source byte-for-byte after normalizing line endings. Compare identifiers, versions, diagnostics, frontmatter symbols and all `bad`/`good`/`no-check` markers.
6. Check the English outline, six-section reference order, spelling, terminology and Markdown formatting. Resolve cross-batch links when the destination translations arrive.
7. Run the applicable site checks with a timeout and `NODE_OPTIONS=--max-old-space-size=8192`. The existing reference regression command from the repository root is `node --test --test-timeout=180000 apps/meeko/tests/reference.test.mjs`; the complete site suite is `pnpm -F meeko-site run test` and also needs an external timeout. Once locale integration lands, run the coordinator's English-specific checks as well. Do not start a server or perform a build just to translate prose.
8. Hand off paths, source revision, checks/results, unresolved links and any terminology questions. Do not commit, push or publish.

## Batch allocation

The inventory below includes every Spanish-source `docs/**/*.md` outside `docs/en/`, including contributor, operational and migration documents. It excludes `taxonomy.json` and other non-Markdown assets, generated API declarations and these two English coordination documents. Paths below are source files; the corresponding destination inserts `en/` immediately after `docs/`.

Balance is based on UTF-8 source bytes, including code, at allocation time. Files are assigned largest first to the currently smallest batch, with alphabetical path and batch-name tie breaks. This measures review volume; `framework.md` remains a single large file owned by batch A. Each translator must check current source changes before working.

<!-- batch-inventory: generated from the source snapshot; one source per bullet -->

| Batch | Files | Source bytes |
| ----- | ----- | ------------ |
| A     | 51    | 810,652      |
| B     | 73    | 809,768      |
| C     | 75    | 811,002      |

### Batch A

- `docs/README.md`
- `docs/framework.md`
- `docs/packages.md`
- `docs/reference/README.md`
- `docs/reference/adapters/attachnodewebsocketserver.md`
- `docs/reference/adapters/createbunassetreader.md`
- `docs/reference/adapters/createcloudflareprerendersource.md`
- `docs/reference/adapters/d1sessiondriver.md`
- `docs/reference/adapters/servedeno.md`
- `docs/reference/adapters/tonodelistener.md`
- `docs/reference/advanced/createapiclient.md`
- `docs/reference/advanced/createframeworkhandler.md`
- `docs/reference/advanced/createrequestcontext.md`
- `docs/reference/advanced/createrpcclient.md`
- `docs/reference/advanced/createsockethub.md`
- `docs/reference/advanced/meeko.md`
- `docs/reference/advanced/mountdevtoolspanel.md`
- `docs/reference/commands/meeko-compile.md`
- `docs/reference/commands/meeko-init-framework.md`
- `docs/reference/commands/meeko-preview.md`
- `docs/reference/components/meekoawait.md`
- `docs/reference/components/meekoteleport.md`
- `docs/reference/components/meekothemetoggle.md`
- `docs/reference/composables/use-rpc-mutation.md`
- `docs/reference/composables/uselayout.md`
- `docs/reference/composables/usestorage.md`
- `docs/reference/composables/usethemetoggle.md`
- `docs/reference/config/config-alias.md`
- `docs/reference/config/config-devtools.md`
- `docs/reference/config/config-document.md`
- `docs/reference/config/config-imports.md`
- `docs/reference/config/config-layers.md`
- `docs/reference/config/config-sitemap.md`
- `docs/reference/macros/defineservermiddleware.md`
- `docs/reference/macros/defineserverroutemiddleware.md`
- `docs/reference/reactivity/oncleanup.md`
- `docs/reference/reactivity/provide.md`
- `docs/reference/reactivity/provideerrorhandler.md`
- `docs/reference/server/composeservermiddleware.md`
- `docs/reference/server/createlocalserverfetch.md`
- `docs/reference/server/generateopenapi.md`
- `docs/reference/syntax/interpolation.md`
- `docs/reference/syntax/render-tag.md`
- `docs/reference/utils/client-api.md`
- `docs/reference/utils/clienterror.md`
- `docs/reference/utils/hashpassword.md`
- `docs/reference/utils/href.md`
- `docs/reference/utils/pageinputerror.md`
- `docs/reference/utils/verifypassword.md`
- `docs/testing.md`
- `docs/tooling.md`

### Batch B

- `docs/api.md`
- `docs/migration-1.1.md`
- `docs/migration-1.6.md`
- `docs/migration-1.7.md`
- `docs/primeros-pasos.md`
- `docs/reference/adapters/createbunserver.md`
- `docs/reference/adapters/createdenoassetreader.md`
- `docs/reference/adapters/createnodesocketupgradehandler.md`
- `docs/reference/adapters/createsocketroomclass.md`
- `docs/reference/adapters/socketroomname.md`
- `docs/reference/advanced/buildproject.md`
- `docs/reference/advanced/createnavigator.md`
- `docs/reference/advanced/createsocketclient.md`
- `docs/reference/advanced/createsocketupgradehandler.md`
- `docs/reference/advanced/loadmeekoconfig.md`
- `docs/reference/advanced/mountclientapp.md`
- `docs/reference/advanced/prerenderroutes.md`
- `docs/reference/advanced/statestore.md`
- `docs/reference/advanced/usesocketclient.md`
- `docs/reference/commands/meeko-auth-hash.md`
- `docs/reference/commands/meeko-dev.md`
- `docs/reference/commands/meeko-init.md`
- `docs/reference/commands/meeko-lsp.md`
- `docs/reference/commands/meeko-prerender.md`
- `docs/reference/commands/meeko-types.md`
- `docs/reference/components/component-tag.md`
- `docs/reference/components/componentregistry.md`
- `docs/reference/components/meekoselect.md`
- `docs/reference/composables/use-api-mutation.md`
- `docs/reference/composables/use-api.md`
- `docs/reference/composables/use-rpc-query.md`
- `docs/reference/composables/use-socket.md`
- `docs/reference/composables/useform.md`
- `docs/reference/composables/usehead.md`
- `docs/reference/composables/useroute.md`
- `docs/reference/composables/usetheme.md`
- `docs/reference/config/config-css.md`
- `docs/reference/config/config-site.md`
- `docs/reference/macros/defineapiroute.md`
- `docs/reference/macros/defineemits.md`
- `docs/reference/macros/definemeekoconfig.md`
- `docs/reference/macros/definemeekomodule.md`
- `docs/reference/macros/definepage.md`
- `docs/reference/macros/defineplugin.md`
- `docs/reference/macros/defineprops.md`
- `docs/reference/macros/defineserverruntime.md`
- `docs/reference/macros/definesnippets.md`
- `docs/reference/macros/useelementref.md`
- `docs/reference/reactivity/createroot.md`
- `docs/reference/reactivity/effect.md`
- `docs/reference/reactivity/onmounted.md`
- `docs/reference/reactivity/signal.md`
- `docs/reference/server/errorresponse.md`
- `docs/reference/server/handleprocesserrors.md`
- `docs/reference/server/localsocketpubsub.md`
- `docs/reference/server/memorysessionstore.md`
- `docs/reference/server/redissocketpubsub.md`
- `docs/reference/server/sessionrevokederror.md`
- `docs/reference/syntax/if-when.md`
- `docs/reference/syntax/model.md`
- `docs/reference/syntax/on.md`
- `docs/reference/syntax/ref.md`
- `docs/reference/syntax/script-server.md`
- `docs/reference/syntax/snippet-tag.md`
- `docs/reference/syntax/style.md`
- `docs/reference/utils/client-socket.md`
- `docs/reference/utils/defer.md`
- `docs/reference/utils/isclienterror.md`
- `docs/reference/utils/notfound.md`
- `docs/reference/utils/serializejson.md`
- `docs/reference/utils/trusthtml.md`
- `docs/releasing.md`
- `docs/roadmap.md`

### Batch C

- `docs/architecture.md`
- `docs/benchmarks.md`
- `docs/como-elegir.md`
- `docs/deploy-meekojs.md`
- `docs/devtools.md`
- `docs/doctor.md`
- `docs/editors.md`
- `docs/i18n.md`
- `docs/migration-1.0.md`
- `docs/migration-1.2.md`
- `docs/migration-1.3.md`
- `docs/migration-1.4.md`
- `docs/migration-1.5.md`
- `docs/migration-1.8.md`
- `docs/performance.md`
- `docs/reference/adapters/createcloudflareassetreader.md`
- `docs/reference/adapters/createnodeassetreader.md`
- `docs/reference/adapters/createworker.md`
- `docs/reference/adapters/durableobjectsocketpubsub.md`
- `docs/reference/adapters/servenode.md`
- `docs/reference/advanced/createserverapp.md`
- `docs/reference/advanced/createserverdispatcher.md`
- `docs/reference/advanced/matchroute.md`
- `docs/reference/advanced/meekoutilities.md`
- `docs/reference/commands/meeko-build.md`
- `docs/reference/commands/meeko-check-app.md`
- `docs/reference/commands/meeko-check.md`
- `docs/reference/commands/meeko-clean.md`
- `docs/reference/commands/meeko-routes.md`
- `docs/reference/commands/meeko-start.md`
- `docs/reference/components/meekolink.md`
- `docs/reference/components/meekooutlet.md`
- `docs/reference/components/meekopopover.md`
- `docs/reference/composables/useid.md`
- `docs/reference/composables/usenavigation.md`
- `docs/reference/composables/usepage.md`
- `docs/reference/composables/userequeststate.md`
- `docs/reference/composables/useseometa.md`
- `docs/reference/composables/usesocketchannel.md`
- `docs/reference/composables/usestate.md`
- `docs/reference/config/config-dev.md`
- `docs/reference/config/config-extends.md`
- `docs/reference/config/config-modules.md`
- `docs/reference/config/config-robots.md`
- `docs/reference/config/config-server.md`
- `docs/reference/config/config-theme.md`
- `docs/reference/macros/defineexpose.md`
- `docs/reference/macros/definegroup.md`
- `docs/reference/macros/definemodel.md`
- `docs/reference/macros/defineroutemiddleware.md`
- `docs/reference/macros/definerpc.md`
- `docs/reference/macros/definesocketchannel.md`
- `docs/reference/reactivity/batch.md`
- `docs/reference/reactivity/computed.md`
- `docs/reference/reactivity/createcontext.md`
- `docs/reference/reactivity/inject.md`
- `docs/reference/reactivity/untrack.md`
- `docs/reference/server/contentsecuritypolicy.md`
- `docs/reference/server/createlocalcalls.md`
- `docs/reference/server/redissessionstore.md`
- `docs/reference/server/sessionhandle.md`
- `docs/reference/server/sessionmanager.md`
- `docs/reference/server/sessionsecurityerror.md`
- `docs/reference/server/sqlsessionstore.md`
- `docs/reference/syntax/bind.md`
- `docs/reference/syntax/each.md`
- `docs/reference/syntax/generic.md`
- `docs/reference/syntax/html.md`
- `docs/reference/syntax/style-scoped.md`
- `docs/reference/utils/apierror.md`
- `docs/reference/utils/client-rpc.md`
- `docs/reference/utils/needsrehash.md`
- `docs/reference/utils/redirect.md`
- `docs/stability.md`
- `docs/ui.md`
