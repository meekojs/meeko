# Avisos de terceros

El código de Meeko UI usa MIT (véase LICENSE). La fuente redistribuida `src/app/styles/fonts/inter-latin-opsz-normal.woff2` pertenece al proyecto Inter y usa SIL Open Font License 1.1; el texto y el copyright se incluyen íntegros en `src/app/styles/fonts/Inter-OFL.txt`. Conserva ese aviso al redistribuir la fuente.

El editor carga `@milkdown/crepe`, `@milkdown/kit`, CodeMirror y `@lezer/highlight` como peers opcionales instalados por el consumidor. No se incorporan sus implementaciones ni sus licencias al tarball de UI. Sus versiones instaladas y licencias deben revisarse al distribuir la aplicación final; sus imports se conservan externos y las hojas de Crepe se resuelven durante el build del consumidor.

Los valores de color de `src/app/styles/hues.css` y el gris alfa de `src/app/styles/palette.css` proceden de Radix Colors (`@radix-ui/colors` 3.0.0), generados por `scripts/build-hues.mjs`. Se redistribuyen bajo su licencia MIT:

```text
MIT License

Copyright (c) 2021 Radix

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
