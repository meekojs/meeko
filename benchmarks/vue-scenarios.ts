import { defineComponent, h, nextTick, ref } from "vue";

const branches = Array.from({ length: 16 }, (_, index) => index);
const leaves = Array.from({ length: 8 }, (_, index) => index);
const rows = Array.from({ length: 40 }, (_, index) => index);

/** Hoja interactiva equivalente a TreeLeaf.meeko. */
const VueTreeLeaf = defineComponent({
  name: "BenchmarkTreeLeaf",
  props: { id: { type: String, required: true } },
  setup(props) {
    const count = ref(0);
    return () => h("button", {
      type: "button",
      "data-id": props.id,
      onClick: () => { count.value++; },
    }, `${props.id}: ${count.value}`);
  },
});

/** Rama con ocho hojas, dentro de un árbol de 16 ramas. */
const VueTreeBranch = defineComponent({
  name: "BenchmarkTreeBranch",
  props: { branch: { type: Number, required: true } },
  setup(props) {
    return () => h("div", { class: "branch" }, leaves.map((leaf) =>
      h("div", { key: leaf }, h(VueTreeLeaf, { id: `${props.branch}-${leaf}` }))));
  },
});

/** Árbol de 145 componentes, contando el nodo raíz. */
export const VueTree = defineComponent({
  name: "BenchmarkTree",
  setup() {
    return () => h("section", branches.map((branch) =>
      h("div", { key: branch }, h(VueTreeBranch, { branch }))));
  },
});

interface Item { id: number; label: string }

/** Lista con 1.000 filas y rotación de claves estable. */
export const VueList = defineComponent({
  name: "BenchmarkList",
  setup() {
    const items = ref<Item[]>(Array.from({ length: 1000 }, (_, id) => ({ id, label: `Row ${id}` })));
    const rotate = (): void => {
      const current = items.value;
      items.value = [current[current.length - 1]!, ...current.slice(0, -1)];
    };
    return () => h("section", [
      h("button", { type: "button", onClick: rotate }, "Rotate"),
      h("ul", items.value.map((item) => h("li", { key: item.id, "data-id": item.id }, item.label))),
    ]);
  },
});

/** Cambio de tres vistas con History API y 40 filas por vista. */
export const VueNavigation = defineComponent({
  name: "BenchmarkNavigation",
  setup() {
    const view = ref(0);
    const navigate = (): void => {
      view.value = (view.value + 1) % 3;
      history.pushState({ view: view.value }, "", `/navigation/${view.value}`);
    };
    const names = ["Home", "Catalog", "Profile"];
    return () => h("main", [
      h("button", { type: "button", onClick: navigate }, "Next view"),
      h("section", { "data-view": view.value }, [
        h("h1", `View ${view.value}`),
        ...rows.map((row) => h("p", { key: row }, `${names[view.value]} ${row}`)),
      ]),
    ]);
  },
});

export { nextTick };
