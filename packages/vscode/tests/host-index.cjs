// Ejecuta en el mismo host de VS Code las pruebas del lenguaje y las de valores en vivo.
exports.run = async function run() {
  await require("./host.cjs").run();
  await require("./host-live.cjs").run();
};
