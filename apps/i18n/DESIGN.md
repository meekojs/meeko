# Diseño de Meeko i18n

Modo de lectura. Conserva la identidad elegida para Meeko UI: Inter autoalojada, superficies neutras, acento azul y acciones principales neutras, con temas claro y oscuro. `meeko-docs` concentra el shell, los tokens y los componentes documentales para ambas webs.

La portada demuestra una traducción con parámetros. Las guías contienen ejemplos copiables y explican el contrato real del paquete. El laboratorio reúne interpolación, plural, selector, moneda y fecha, con catálogos de español, inglés y árabe.

La estructura documental permanece en español/LTR. El resultado del laboratorio declara idioma y dirección propios, y permite observar RTL sin invertir las instrucciones españolas. Usa propiedades lógicas y texto legible en ambos sentidos. El contenido debe poder leerse y navegarse sin JavaScript; los controles interactivos requieren hidratación.

Mantén el máximo de lectura y usa `UIContainer` para la estructura amplia. Las tablas y bloques de código desplazan su propio contenido horizontalmente; la página no debe desbordarse. No añadas cifras, idiomas o capacidades que el módulo no soporte.
