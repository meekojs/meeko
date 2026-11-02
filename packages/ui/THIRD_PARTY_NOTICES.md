# Avisos de terceros

El código de Meeko UI usa MIT (véase LICENSE). La fuente redistribuida `src/app/styles/fonts/inter-latin-opsz-normal.woff2` pertenece al proyecto Inter y usa SIL Open Font License 1.1; el texto y el copyright se incluyen íntegros en `src/app/styles/fonts/Inter-OFL.txt`. Conserva ese aviso al redistribuir la fuente.

El editor carga `@milkdown/crepe`, `@milkdown/kit`, CodeMirror y `@lezer/highlight` como peers opcionales instalados por el consumidor. No se incorporan sus implementaciones ni sus licencias al tarball de UI. Sus versiones instaladas y licencias deben revisarse al distribuir la aplicación final; sus imports se conservan externos y las hojas de Crepe se resuelven durante el build del consumidor.
