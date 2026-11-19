# Diseño de Meeko i18n

Modo de lectura. **Esta web no escribe diseño:** ni CSS ni tokens. La autoridad visual es [`packages/ui/DESIGN.md`](../../packages/ui/DESIGN.md), y `meeko-docs` concentra el Shell y los componentes documentales de las webs de documentación.

La portada usa el mismo layout a ancho completo de Meeko y UI, y demuestra una traducción con parámetros. Las guías contienen ejemplos copiables y explican el contrato real del paquete. El laboratorio reúne interpolación, plural, selector, moneda y fecha, con catálogos de español, inglés y árabe.

La estructura documental permanece en español/LTR. El resultado del laboratorio declara idioma y dirección propios, y permite observar RTL sin invertir las instrucciones españolas. Usa propiedades lógicas y texto legible en ambos sentidos. El contenido debe poder leerse y navegarse sin JavaScript; los controles interactivos requieren hidratación.

Mantén el máximo de lectura y usa `UIContainer` para la estructura amplia. Las tablas y bloques de código desplazan su propio contenido horizontalmente; la página no debe desbordarse. No añadas cifras, idiomas o capacidades que el módulo no soporte.
