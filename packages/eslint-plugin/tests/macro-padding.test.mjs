import { Linter, RuleTester } from 'eslint';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import parser from '../dist/parser.js';
import plugin from '../dist/plugin.js';
import padding from '../dist/rules/padding-line-between-macros.js';

const tester = new RuleTester({ languageOptions: { parser } });
const script = (body) => `<script lang="ts">${body}</script><template><div></div></template>`;
const props = 'const props = defineProps<{name: string}>();';
const emit = 'const emit = defineEmits();';

tester.run('padding-line-between-macros', padding, {
  valid: [
    script(`${props}\n\n${emit}`),
    script(`${props}\n\n\n${emit}`),
    script(`${props}\r\n\t\r\n\t${emit}`),
    script(`${props} // props\n\n// events\n${emit}`),
    script(`${props}\n\n/** Events */\n${emit}`),
    script(`${props}\n\nconst other = 1;\n${emit}`),
    script(`${props}\n\ntype Other = string;\n${emit}`),
    script(`${props}`),
    script(`${props}\n// End of setup\n`),
    script(`${props}\n\nfunction save() {} `),
    script('function nested() { const props = defineProps(); const emit = defineEmits(); }'),
    script('function defineProps() {} const props = defineProps(); const emit = defineEmits();'),
    script('import { defineProps } from "custom"; const props = defineProps(); const emit = defineEmits();'),
    '<script server lang="ts">const props = defineProps();</script><script lang="ts">const emit = defineEmits();</script><template><div></div></template>',
    '<template><div></div></template>',
  ],
  invalid: [
    { code: script(`${props}\nconst other = 1;`), output: script(`${props}\n\nconst other = 1;`), errors: [{ messageId: 'padding' }] },
    { code: script(`${props}\ntype Other = string;`), output: script(`${props}\n\ntype Other = string;`), errors: [{ messageId: 'padding' }] },
    { code: script(`${props}\ninterface Other { id: number }`), output: script(`${props}\n\ninterface Other { id: number }`), errors: [{ messageId: 'padding' }] },
    { code: script(`${props}\nfunction save() {}`), output: script(`${props}\n\nfunction save() {}`), errors: [{ messageId: 'padding' }] },
    { code: script(`${props}\nif (true) save();`), output: script(`${props}\n\nif (true) save();`), errors: [{ messageId: 'padding' }] },
    { code: script(`${props} // props\n// save handler\nfunction save() {}`), output: script(`${props} // props\n\n// save handler\nfunction save() {}`), errors: [{ messageId: 'padding' }] },
    { code: script(`${props}\r\n\tconst state = signal(0);`), output: script(`${props}\r\n\r\n\tconst state = signal(0);`), errors: [{ messageId: 'padding' }] },
    { code: script('defineExpose({});\nsetup();'), output: script('defineExpose({});\n\nsetup();'), errors: [{ messageId: 'padding' }] },
    { code: script(`${props}\n${emit}`), output: script(`${props}\n\n${emit}`), errors: [{ messageId: 'padding', line: 2 }] },
    { code: script(`${props} ${emit}`), output: script(`${props}\n\n${emit}`), errors: [{ messageId: 'padding' }] },
    { code: script(`\n\t${props}\n\t${emit}\n`), output: script(`\n\t${props}\n\n\t${emit}\n`), errors: [{ messageId: 'padding' }] },
    { code: script(`${props}\r\n\t${emit}`), output: script(`${props}\r\n\r\n\t${emit}`), errors: [{ messageId: 'padding' }] },
    { code: script(`${props} // props\n${emit}`), output: script(`${props} // props\n\n${emit}`), errors: [{ messageId: 'padding' }] },
    { code: script(`${props}\n// events\n${emit}`), output: script(`${props}\n\n// events\n${emit}`), errors: [{ messageId: 'padding' }] },
    { code: script(`${props}\n/** Events\n\n * Details\n */\n${emit}`), output: script(`${props}\n\n/** Events\n\n * Details\n */\n${emit}`), errors: [{ messageId: 'padding' }] },
    { code: script(`${props} /* props */ ${emit}`), output: script(`${props} /* props */\n\n ${emit}`), errors: [{ messageId: 'padding' }] },
    { code: script('const props = defineProps<{\n name: string;\n}>();\nconst emit = defineEmits();'), output: script('const props = defineProps<{\n name: string;\n}>();\n\nconst emit = defineEmits();'), errors: [{ messageId: 'padding' }] },
    { code: script('const first = defineModel("first");\nconst second = defineModel("second");'), output: script('const first = defineModel("first");\n\nconst second = defineModel("second");'), errors: [{ messageId: 'padding' }] },
    { code: script('const ref = useElementRef("field");\ndefineExpose({ ref });'), output: script('const ref = useElementRef("field");\n\ndefineExpose({ ref });'), errors: [{ messageId: 'padding' }] },
    { code: '<script server lang="ts">const props = defineProps();\nconst emit = defineEmits();</script><template><div></div></template>', output: '<script server lang="ts">const props = defineProps();\n\nconst emit = defineEmits();</script><template><div></div></template>', errors: [{ messageId: 'padding' }] },
  ],
});

test('macro ordering and padding autofixes converge without changing code or comments', () => {
  const linter = new Linter();
  const config = [{ languageOptions: { parser }, plugins: { meeko: plugin }, rules: { 'meeko/order-macros': 'error', 'meeko/padding-line-between-macros': 'error' } }];
  const input = script('const emit = defineEmits();\nconst props = defineProps();\nconst model = defineModel();');
  const result = linter.verifyAndFix(input, config);
  assert.deepEqual(result.messages, []);
  assert.equal(result.output, script('const props = defineProps();\n\nconst emit = defineEmits();\n\nconst model = defineModel();'));
  assert.equal(linter.verifyAndFix(result.output, config).fixed, false);
});
