/** Estado serializable de una tarea de la aplicación piloto. */
export interface Task {
  id: string;
  title: string;
  detail: string;
  done: boolean;
}

/** Vista seleccionada por la ruta HTTP. */
export type TaskView = "active" | "completed";

/** Datos iniciales compartidos por el render del servidor y la API de ejemplo. */
export const initialTasks: readonly Task[] = [
  { id: "design", title: "Revisar el diseño", detail: "Validar jerarquía y accesibilidad de la pantalla.", done: false },
  { id: "tests", title: "Cubrir la hidratación", detail: "Probar la página servida y las interacciones reales.", done: false },
  { id: "docs", title: "Documentar el motor", detail: "Publicar una guía de inicio para nuevos proyectos.", done: true },
];

/** Comprueba la respuesta de la API antes de incorporarla al estado reactivo. */
export function parseTasks(value: unknown): Task[] {
  if (!Array.isArray(value)) throw new TypeError("La API no devolvió una lista de tareas.");
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) throw new TypeError(`Tarea ${index} inválida.`);
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.id !== "string" || typeof candidate.title !== "string" || typeof candidate.detail !== "string" || typeof candidate.done !== "boolean") {
      throw new TypeError(`Tarea ${index} inválida.`);
    }
    return { id: candidate.id, title: candidate.title, detail: candidate.detail, done: candidate.done };
  });
}
