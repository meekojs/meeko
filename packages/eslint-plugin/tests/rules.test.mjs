import { RuleTester } from 'eslint';
import parser from '../dist/parser.js';
import plugin from '../dist/index.js';

const tester = new RuleTester({ languageOptions: { parser } });
tester.run('button-has-type', plugin.rules['button-has-type'], {
  valid: [
    { code: '<template><button type="submit">Send</button></template>' },
    { code: '<script lang="ts">const type = "button";</script><template><button bind:type="type">Run</button></template>' },
    { code: '<template><Button /></template>' },
  ],
  invalid: [{
    code: '<template><button class="save">Save</button></template>',
    errors: [{ messageId: 'missing', line: 1, column: 12, suggestions: [
      { messageId: 'button', output: '<template><button type="button" class="save">Save</button></template>' },
      { messageId: 'submit', output: '<template><button type="submit" class="save">Save</button></template>' },
    ] }],
    output: null,
  }],
});

tester.run('no-autofocus', plugin.rules['no-autofocus'], {
  valid: [
    { code: '<template><input /></template>' },
    { code: '<template><Input autofocus /></template>' },
    { code: '<template><x-editor autofocus></x-editor></template>' },
  ],
  invalid: [{
    code: '<template><input autofocus></template>',
    errors: [{ messageId: 'unexpected', suggestions: [{ messageId: 'remove', output: '<template><input ></template>' }] }],
    output: null,
  }],
});
