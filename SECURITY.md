# Política de seguridad

## Versiones con soporte

| Versión                  | Correcciones de seguridad     |
| ------------------------ | ----------------------------- |
| Último minor de 1.x      | Sí                            |
| Minors anteriores de 1.x | No; actualice al último minor |
| 0.x                      | No                            |

Las prereleases (`1.0.0-rc.N`) reciben correcciones en la siguiente prerelease o en la versión final.

## Cómo informar de una vulnerabilidad

No publique los detalles en un issue, una discusión o un pull request.

Use el informe privado de GitHub: en [meekojs/meeko](https://github.com/meekojs/meeko), pestaña **Security**, botón **Report a vulnerability** (o directamente [este enlace](https://github.com/meekojs/meeko/security/advisories/new)). Incluya la versión de `@meekojs/meeko`, el runtime y el adaptador (Node, Bun, Deno o Cloudflare Workers), los pasos para reproducirla y el impacto que observa.

## Qué puede esperar

- Una primera respuesta en un plazo de 7 días.
- Confirmación o descarte del problema y, si se confirma, un plan de corrección.
- Una versión corregida y un aviso de seguridad (GitHub Security Advisory) que reconocerá su informe, salvo que prefiera no aparecer.

Según [la política de estabilidad](docs/stability.md), una corrección de seguridad que no pueda ser compatible puede publicarse en un patch o un minor, documentada en el CHANGELOG.
