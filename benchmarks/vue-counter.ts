import { computed, defineComponent, h, ref } from "vue";

/** Contraparte Vue del contador de Meeko usado en la comparativa. */
export const VueCounter = defineComponent({
  name: "BenchmarkCounter",
  props: {
    initial: { type: Number, default: 0 },
  },
  setup(props) {
    const count = ref(props.initial);
    const doubled = computed(() => count.value * 2);
    return () => h("button", {
      type: "button",
      onClick: () => { count.value++; },
    }, `${count.value} · doble: ${doubled.value}`);
  },
});
