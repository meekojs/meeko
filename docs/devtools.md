# Meeko DevTools

DevTools permite examinar y editar cada instancia hidratada durante el desarrollo con Vite. Hay dos interfaces sobre el mismo runtime: un panel dentro de la página y un panel de Chrome DevTools. Ambas consumen el hook `window.__MEEKO_DEVTOOLS__`, que sólo existe en desarrollo.

## Panel dentro de la página

El ejemplo Vite lo monta automáticamente en modo desarrollo:

```powershell
pnpm run build
pnpm run vite:dev
```

Una aplicación puede montar el panel explícitamente:

```ts
if (import.meta.env.DEV) {
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  const panel = mountDevtoolsPanel();
  // panel.unmount() libera la interfaz cuando deje de usarse.
}
```

El panel ofrece:

- un árbol de instancias;
- el detalle de props y señales;
- un editor de señales;
- una línea de tiempo filtrable;
- resaltado del DOM;
- un punto de parada por instancia.

Cada evento conserva el nombre y el archivo `.meeko` del componente y una copia segura del nuevo valor. Al seleccionar un evento de una instancia activa se abre su detalle. Los estilos viven en Shadow DOM para no alterar los de la aplicación.

## Panel de Chrome DevTools

1. Abre `chrome://extensions`, activa el modo de desarrollador y carga la carpeta `tools/devtools-extension` como extensión descomprimida.
2. Abre una aplicación Meeko servida por Vite en desarrollo y después las herramientas de desarrollador de Chrome.
3. En la pestaña **Meeko**:
   - selecciona una instancia para ver sus props, sus señales y su línea de tiempo;
   - filtra por señales o por instancia, y pulsa un evento para volver a su componente activo;
   - edita una señal desde **Editar señal**;
   - usa **Resaltar** para ubicar la instancia en la página;
   - activa el punto de parada y provoca una actualización de su señal.

La extensión consulta el hook de la página inspeccionada. No necesita cuenta, servicio remoto, permisos de host ni scripts de contenido. Su versión (`1.0.0`) es independiente de la del paquete npm; la instalación, el empaquetado y las pruebas se describen en [`tools/devtools-extension/README.md`](../tools/devtools-extension/README.md).

## Protocolo

El hook y cada captura declaran `protocolVersion: 1`. Los tipos públicos se exportan desde `@meekojs/meeko`:

- `DevtoolsHook`, `DevtoolsSnapshot`, `DevtoolsInstance`, `DevtoolsEvent`, `DevtoolsEventKind` y `DevtoolsValue`;
- `DevtoolsReadSite` y `DevtoolsReadKind`, para las lecturas;
- `DevtoolsWriteSite`, `DevtoolsAssignmentSite` y `DevtoolsEditSite`, para las escrituras;
- `DevtoolsCommandResult` y `DevtoolsProtocolVersion`;
- `DevtoolsSignalSite` (desde `1.1`), para la declaración de una señal.

Desde `1.1`, cada `DevtoolsInstance` de la captura puede llevar el campo opcional `signalSites`: un objeto que asocia el nombre de cada señal de `signals` con su declaración en el `.meeko` (`{ file, line, column }`, con línea y columna desde 1). Sólo aparece cuando la compilación de desarrollo conoce esa posición; un cliente del protocolo debe tratarlo como opcional.

El hook expone:

| Método | Efecto |
| --- | --- |
| `snapshot()` | Captura serializable de instancias, eventos recientes y selección. |
| `subscribe(listener)` | Avisa de cada cambio; devuelve la función para cancelar la suscripción. |
| `select(id)` / `highlight(id)` | Selecciona o resalta una instancia; `null` las retira. |
| `setBreakpoint(id, enabled)` | Activa o desactiva el punto de parada de una instancia. |
| `setSignal(instanceId, name, value)` | Sustituye el valor de una señal editable y devuelve `{ ok: true }` o `{ ok: false, error }`. |

La versión sólo cambia con incompatibilidades y, según la [política de estabilidad](stability.md#devtools-y-editor), sólo en una versión major de Meeko. Dentro del protocolo 1 pueden aparecer campos o tipos de evento nuevos. Los dos paneles rechazan un hook o una captura con otra versión, o sin ella (runtimes anteriores a 1.0), y muestran un mensaje que indica la versión encontrada y la admitida. Nunca leen datos de un protocolo que no conocen. El panel integrado viaja en el mismo paquete que el runtime. La extensión de Chrome necesita un `@meekojs/meeko` que implemente el protocolo 1.

`src/devtools-protocol.ts` es la única fuente de los tipos. La extensión usa una copia generada en `tools/devtools-extension/types/protocol.d.ts`, que su `tsc` con `checkJs` comprueba sobre `protocol.js` y `panel.js`. Para regenerarla después de cambiar el protocolo:

```powershell
pnpm run devtools:types
```

`pnpm run devtools:check` falla si la copia queda desactualizada.

## Editar señales

Los dos paneles muestran un formulario **Editar señal** para la instancia seleccionada. Funciona así:

1. Elige una señal editable de la instancia. Los `computed` y los valores que no son señales no aparecen.
2. Escribe el nuevo valor en JSON y pulsa **Aplicar**.
3. El panel valida el JSON antes de enviarlo y muestra el error junto al botón si no es válido.
4. El runtime vuelve a validar el valor y lo asigna con `signal.value = value`. Los efectos, la plantilla y el punto de parada reaccionan como ante cualquier otra escritura.

Reglas:

- Sólo existe en desarrollo, porque el hook no se crea en SSR ni en producción.
- El valor sustituye el valor completo de la señal; no se fusiona con el anterior.
- El valor debe ser JSON estricto: `null`, booleanos, cadenas, números finitos, arrays y objetos planos, sin ciclos ni accesores.
- El texto inicial del editor es la copia acotada que muestra el panel, no necesariamente el valor original completo. Si el valor real era más profundo o largo que la copia, aplicar ese texto sin cambios lo reemplaza por la versión truncada.
- `setSignal` responde `{ ok: false, error }` si la instancia ya no está activa, si el nombre no es una señal editable propia o si el valor no es JSON válido.
- Si un observador lanza al propagar el cambio, el valor ya quedó escrito y la respuesta es `{ ok: false }` con el error.
- El evento resultante se marca como «Escrita desde DevTools» (`write: { kind: "devtools" }`).

## Puente del editor

Desde `1.1`, `meeko dev` publica los valores de las señales de las páginas abiertas para un editor local, que los muestra junto al código y puede editarlos (véase la [extensión de VS Code](../editors/vscode/README.md#valores-en-vivo)). El puente sólo existe en desarrollo y su protocolo no forma parte del contrato público (véase la [política de estabilidad](stability.md#fuera-del-contrato)).

### Funcionamiento

1. Al escuchar en loopback, `meeko dev` genera un token aleatorio por sesión y escribe un descriptor propio de su puerto, `.meeko/dev/editor-bridge-<puerto>.json` (con permisos `0600` donde el sistema los admite):

   ```json
   { "protocol": 1, "url": "http://127.0.0.1:4173/__meeko/editor-bridge", "token": "…", "pid": 12345, "root": "/ruta/al/proyecto", "startedAt": "2026-10-26T10:00:00.000Z" }
   ```

   Varios `meeko dev` del mismo proyecto, en puertos distintos, conviven sin sustituirse el descriptor, y el editor se conecta a todos. Al cerrarse, cada servidor borra el suyo si sigue siendo de su sesión. Al arrancar, borra los descriptores huérfanos de procesos que ya no existen (por ejemplo, de un `meeko dev` terminado a la fuerza), incluido el `.meeko/dev/editor-bridge.json` único de las versiones de desarrollo anteriores. El puerto es el que `meeko dev` usa de verdad: si `4173` estaba ocupado y tomó `4174`, el descriptor es `editor-bridge-4174.json`. Cuando `meeko dev` se reinicia porque cambió un `@meekojs/meeko` enlazado, el servidor nuevo escucha en el mismo puerto y escribe un descriptor con otra sesión y otro token; el editor vuelve a conectarse con él.
2. El editor lee los descriptores y abre `GET <url>/events` en cada uno, un stream SSE con los eventos `hello` (`protocol`, `session`, `root`), `snapshot` (todas las señales) y `update` (señales nuevas o cambiadas y las que desaparecen en `removed`). Si no había otro editor conectado, las pestañas abiertas no estaban enviando valores: el servidor les pide su estado y espera a que todas respondan, o como mucho unos 300 ms, antes de enviar `snapshot`; sin pestañas lo envía al momento. Lo que llega durante esa espera va en la propia instantánea, no en un `update`.
3. Para editar una señal, el editor envía `POST <url>/command` con `{ "type": "setSignal", "id", "value" }`. El servidor reenvía la orden a la pestaña que tiene la instancia y responde con su resultado, `{ ok: true }` o `{ ok: false, error }`, como `setSignal` del hook.
4. Entre el navegador y `meeko dev` los mensajes viajan por el WebSocket de HMR de Vite. El navegador sólo envía valores mientras hay al menos un editor conectado.

Cada señal lleva un `id` estable mientras vive la instancia (`pestaña/instancia/nombre`), el componente, el archivo `.meeko`, la línea y columna de su declaración (de `signalSites`) y su valor en JSON, copiado con los mismos límites que DevTools. Si la señal es el mismo objeto que otra de la pestaña, como el modelo que un hijo recibe del padre con `defineModel`, lleva además `alias` con la señal principal (`id`, `instanceId`, `component`, `name`, `file` y su línea y columna). La principal es la que declara la señal, no la que la recibe prestada, o la primera registrada. El editor muestra el alias junto a la principal y envía las ediciones a ella. Un valor de más de 4096 caracteres se recorta y se marca `truncated`; ese texto ya no es JSON válido. El navegador agrupa los cambios cada 100 ms y limita cada mensaje a unos 128 KB. El cuerpo de un comando admite como mucho 1 MB y una orden que la pestaña no responde en 5 s falla.

### Seguridad

Cada petición al puente debe cumplir todas estas condiciones; si no, responde `403` o `401` sin procesarla:

- **Loopback.** La conexión llega desde una dirección de loopback (`127.0.0.0/8` o `::1`).
- **`Host`.** La cabecera `Host` nombra un host de loopback (`localhost`, `127.x.x.x` o `[::1]`), lo que corta los ataques de DNS rebinding.
- **Sin `Origin`.** Una petición con cabecera `Origin` se rechaza, aunque venga de loopback. Los editores son procesos locales y no la envían; una página abierta en el navegador siempre la envía, así que ninguna puede usar el puente. Además, el plugin de Vite añade `**/.meeko/dev/**` a `server.fs.deny`, así que ninguna página puede leer el descriptor ni su token.
- **Token.** La cabecera `Authorization: Bearer <token>` lleva el token del descriptor, que se compara en tiempo constante.

`meeko dev` sólo arranca el puente cuando el servidor escucha en loopback o en todas las interfaces (`0.0.0.0` o `::`); en ese caso el descriptor apunta a `127.0.0.1`. Con otra dirección no hay puente. Para desactivarlo, arranque con `MEEKO_EDITOR_BRIDGE=0`:

```powershell
$env:MEEKO_EDITOR_BRIDGE = "0"; npm run dev
```

Si el puente no puede arrancar, `meeko dev` lo informa en la consola y la aplicación sigue funcionando sin valores en vivo.

## Ubicaciones en la línea de tiempo

Las ubicaciones sólo se generan en desarrollo, cuando el compilador trabaja con `hot`. En producción el código compilado no incluye instrumentación y el HTML de SSR es idéntico.

### Lecturas

Cada evento de señal se puede desplegar para ver las expresiones que dependían de ella en esa instancia, con archivo, línea, columna y tipo de lectura:

| Tipo | Origen |
| --- | --- |
| `text` | Interpolación `{...}` de la plantilla. |
| `attribute` | Atributo enlazado (`bind:`). |
| `computed` | Función pasada a `computed(...)` en el script `.meeko`. |
| `if` | Condición `if:when`. |
| `each` | Lista `each:of`. |
| `prop` | Prop pasada a un componente hijo (`name` indica la prop). |

El seguimiento usa las dependencias activas de cada instancia, así que una rama que ya no lee la señal deja de aparecer. Una lectura indica **dónde se usa** la señal, no quién la escribió.

### Escrituras

Cada evento de señal indica también qué escribió el nuevo valor, cuando se conoce:

- **Escrita en `archivo:línea:columna`**: es una asignación a `.value` del archivo `.meeko`. Cubre `=`, `??=`, `||=` y `&&=`, las asignaciones compuestas (`+=`, `-=`, …) y `++`/`--`. Vale tanto en el script como en las expresiones `on:` de la plantilla.
- **Escrita desde DevTools**: es una edición hecha con `setSignal`.

La atribución dura hasta el final de la tarea síncrona en curso y sólo se aplica si el valor coincide con el escrito. Una señal que cambia en cascada a partir de otra no hereda su origen.

## Alcance y límites

- El hook aparece sólo al hidratar componentes compilados por Vite en desarrollo. No se crea durante SSR ni en el build de producción.
- Una instancia aparece con el estado «Hidratado» al completar su hidratación. Al desmontarse desaparece del árbol y deja un evento de desmontaje.
- Los valores mostrados son copias acotadas y serializables, para que ambos paneles puedan transportarlos sin ejecutar código de la aplicación:
  - profundidad 4, 50 elementos o claves por nivel y 500 caracteres por cadena;
  - funciones, nodos DOM y accesores se resumen;
  - la línea de tiempo conserva los 100 eventos más recientes.
- Algunas escrituras no tienen ubicación:
  - las hechas fuera de un archivo `.meeko`, por ejemplo en un módulo `.ts` importado;
  - las que no tienen un destino estable, como `make().value = 1` o `items[0].value = 1` (sólo se instrumentan identificadores, `this` y cadenas de propiedades con punto);
  - las asignaciones compuestas y los `++`/`--` que contienen un `await` o un `yield` directo. Las asignaciones simples con `await` sí se ubican.
- Una lectura sólo se ubica como `computed` cuando se llama al identificador `computed` con una función literal como argumento. Un alias o una función pasada por referencia no reciben ubicación.
- El punto de parada se dispara con los cambios de las señales editables del componente seleccionado. Para que el navegador pause, mantén abiertas las herramientas de desarrollo.
- DevTools no depura paso a paso cada expresión de plantilla.
