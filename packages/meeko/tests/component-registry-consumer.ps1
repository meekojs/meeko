param([string]$Tarball)

$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([char[]]@('\', '/'))
$runRoot = Join-Path $tempRoot ('meeko-registry-consumer-' + [guid]::NewGuid().ToString('N'))
$consumer = Join-Path $runRoot 'consumer'

function Write-Fixture([string]$RelativePath, [string]$Content) {
  $target = Join-Path $consumer $RelativePath
  $directory = Split-Path -Parent $target
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  Set-Content -LiteralPath $target -Value $Content -Encoding utf8
}

function Assert-Command([string]$Description) {
  if ($LASTEXITCODE -ne 0) { throw $Description }
}

try {
  New-Item -ItemType Directory -Path $consumer -Force | Out-Null
  if ($Tarball) {
    $archive = (Resolve-Path -LiteralPath $Tarball).Path
  } else {
    # npm pack runs the package's prepack build. Nothing is published.
    $filename = (& npm pack $packageRoot --pack-destination $runRoot | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0 -or !$filename) { throw 'npm pack failed.' }
    $archive = Join-Path $runRoot $filename
  }

  Write-Fixture 'package.json' '{"name":"meeko-registry-consumer","private":true,"type":"module","scripts":{"check":"meeko check .","build":"vite build"}}'
  Write-Fixture 'meeko.config.ts' @'
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  components: {
    dirs: [
      { path: "app/components", prefix: "" },
      { path: "app/components/Form", prefix: "Form" },
    ],
  },
});
'@
  Write-Fixture 'app/components/Button.meeko' @'
<script lang="ts">
const props = defineProps<{ label: string; tone?: "primary" | "quiet" }>();
</script>
<template><button>{props.label}</button></template>
'@
  Write-Fixture 'app/components/Form/UserCreate.meeko' @'
<script lang="ts">
const props = defineProps<{ name: string; role?: "admin" | "reader" }>();
</script>
<template><p>{props.name}</p></template>
'@
  Write-Fixture 'app/pages/index.meeko' '<template><main>Registry consumer</main></template>'
  Write-Fixture 'app/utils/registry-positive.ts' @'
import type { ComponentName as Name, ComponentProps as Props, ComponentOf as Of, ComponentArgs } from "@meekojs/meeko";

const button: Name = "Button";
const form: Name = "FormUserCreate";
const input: Props<"FormUserCreate"> = { name: "Diego", role: "admin" };
const optional: Props<"Button"> = { label: "Save" };
const autoName: ComponentName = "FormUserCreate";
const autoProps: ComponentProps<"Button"> = { label: "Open", tone: "quiet" };
const modulePromise: Promise<Of<"FormUserCreate">> = resolveComponent("FormUserCreate");
const modulePromiseAuto: Promise<ComponentOf<"Button">> = resolveComponent("Button");
function openModal(...args: ComponentArgs): void { void args; }
openModal("FormUserCreate", { name: "Diego", role: "reader" });
void button; void form; void input; void optional; void autoName; void autoProps;
void modulePromise; void modulePromiseAuto;
'@
  Write-Fixture 'vite.config.ts' @'
import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";

export default defineConfig({ plugins: [meeko()] });
'@
  Write-Fixture 'index.html' '<!doctype html><html><body><main id="app"></main><script type="module" src="/main.ts"></script></body></html>'
  Write-Fixture 'main.ts' @'
import { resolveComponent } from "./.meeko/generated/components.ts";

const root = document.querySelector("#app");
if (root) {
  root.addEventListener("click", () => {
    void resolveComponent("FormUserCreate").then((component) => {
      root.textContent = component.renderToString({ name: "Diego" });
    });
  });
}
'@
  Write-Fixture 'ssr-smoke.mjs' @'
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, hmr: false }, logLevel: "silent" });
try {
  const registry = await server.ssrLoadModule("/.meeko/generated/components.ts");
  const pending = registry.resolveComponent("FormUserCreate");
  if (!(pending instanceof Promise)) throw new Error("resolveComponent must return a Promise");
  const component = await pending;
  if (!component.renderToString({ name: "Diego" }).includes("Diego")) {
    throw new Error("The installed component module did not render its props in SSR");
  }
  await import("node:assert/strict").then(({ default: assert }) =>
    assert.rejects(registry.resolveComponent("Missing"), /no registrado: Missing/));
} finally {
  await server.close();
}
'@

  & npm install --prefix $consumer --no-audit --no-fund $archive 'vite@8.3.5' 'typescript@7.0.2' '@types/node@^24'
  Assert-Command 'Could not install the packed Meeko package in the external consumer.'

  Push-Location $consumer
  try {
    $cli = Join-Path $consumer 'node_modules/.bin/meeko.cmd'
    if (!(Test-Path -LiteralPath $cli)) { throw 'The installed tarball has no meeko CLI.' }
    & $cli check .
    Assert-Command 'meeko check failed for the positive registry consumer.'

    $types = Get-Content -LiteralPath (Join-Path $consumer '.meeko/types/components.d.ts') -Raw
    foreach ($name in @('Button', 'FormUserCreate')) {
      if (!$types.Contains('readonly "' + $name + '": typeof import(')) {
        throw "Generated ComponentRegistry does not contain $name."
      }
    }
    if ($types.Contains('FormFormUserCreate')) { throw 'Overlapping directories duplicated the Form prefix.' }
    $loader = Get-Content -LiteralPath (Join-Path $consumer '.meeko/generated/components.ts') -Raw
    if ($loader -match 'import\(name\)' -or $loader -match '[A-Za-z]:\\') { throw 'The generated loader contains a dynamic or absolute import.' }

    & node ssr-smoke.mjs
    Assert-Command 'Vite SSR could not load the registered component from the installed package.'

    Write-Fixture 'app/utils/registry-negative.ts' @'
import type { ComponentName, ComponentProps, ComponentOf } from "@meekojs/meeko";
const unknown: ComponentName = "Missing";
const missing: ComponentProps<"FormUserCreate"> = {};
const invalid: ComponentProps<"Button"> = { label: "Save", tone: "danger" };
const wrongModule: Promise<ComponentOf<"Button">> = resolveComponent("FormUserCreate");
void unknown; void missing; void invalid; void wrongModule;
'@
    $diagnostics = & node node_modules/typescript/bin/tsc -p .meeko/tsconfig.app.json --noEmit --pretty false 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) { throw 'Negative TypeScript fixture unexpectedly passed.' }
    foreach ($line in @(2, 3, 4, 5)) {
      if ($diagnostics -notmatch "registry-negative\.ts\($line,\d+\): error TS\d+") {
        throw "Negative TypeScript fixture did not report line $line. Diagnostics: $diagnostics"
      }
    }
    Remove-Item -LiteralPath (Join-Path $consumer 'app/utils/registry-negative.ts')

    & $cli check .
    Assert-Command 'meeko check did not recover after removing the negative fixture.'
    & node node_modules/vite/bin/vite.js build
    Assert-Command 'Vite production build failed for the external registry consumer.'
  } finally {
    Pop-Location
  }
  Write-Output 'External component registry consumer: package, types (positive/negative), async resolver, SSR and Vite build OK.'
} finally {
  $resolved = [System.IO.Path]::GetFullPath($runRoot)
  $expectedPrefix = $tempRoot + [System.IO.Path]::DirectorySeparatorChar
  if ($resolved.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
      [System.IO.Path]::GetFileName($resolved).StartsWith('meeko-registry-consumer-', [System.StringComparison]::Ordinal) -and
      (Test-Path -LiteralPath $resolved)) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
