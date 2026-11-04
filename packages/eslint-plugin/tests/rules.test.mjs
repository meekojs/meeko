import { RuleTester } from 'eslint'

import plugin from '../dist/index.js'
import parser from '../dist/parser.js'

const tester = new RuleTester({ languageOptions: { parser } })
tester.run('button-has-type', plugin.rules['button-has-type'], {
	valid: [
		{ code: '<template><button type="submit">Send</button></template>' },
		{ code: '<script lang="ts">const type = "button";</script><template><button bind:type="type">Run</button></template>' },
		{ code: '<template><Button /></template>' },
	],
	invalid: [
		{
			code: '<template><button class="save">Save</button></template>',
			errors: [
				{
					messageId: 'missing',
					line: 1,
					column: 12,
					suggestions: [
						{ messageId: 'button', output: '<template><button type="button" class="save">Save</button></template>' },
						{ messageId: 'submit', output: '<template><button type="submit" class="save">Save</button></template>' },
					],
				},
			],
			output: null,
		},
	],
})

tester.run('prefer-ui-components', plugin.rules['prefer-ui-components'], {
	valid: [
		{ code: '<template><UIButton>Save</UIButton><Button /><UITable /></template>' },
		{ code: '<template><input type="hidden" name="token" /></template>' },
		{ code: '<template><input type="HIDDEN" name="token" /></template>' },
		{ code: '<template><x-select></x-select><label>Name</label><form></form></template>' },
		{ code: '<template><pre>&lt;button&gt;</pre><code>button</code></template>', name: 'the name of a tag in a text is not a tag' },
		{ code: '<template><table></table><button type="button">a</button></template>', options: [{ allow: ['table', 'button'] }] },
		{ code: '<script lang="ts">const html = "<button>";</script><template><p>{html}</p></template>' },
		{ code: '<template><UIModal><snippet name="default"><p /></snippet></UIModal></template>' },
	],
	invalid: [
		{ code: '<template><button type="button">Save</button></template>', errors: [{ messageId: 'prefer', line: 1, column: 12, data: { tag: 'button', component: 'UIButton' } }], output: null },
		{ code: '<template><input /></template>', errors: [{ messageId: 'prefer', data: { tag: 'input', component: 'UIInput' } }], output: null },
		{ code: '<template><input type="email" /></template>', errors: [{ messageId: 'prefer', data: { tag: 'input', component: 'UIInput' } }], output: null },
		{ code: '<template><input type="checkbox" /></template>', errors: [{ messageId: 'prefer', data: { tag: 'input', component: 'UICheckbox' } }], output: null },
		{ code: '<template><input type="radio" /></template>', errors: [{ messageId: 'prefer', data: { tag: 'input', component: 'UIRadioGroup' } }], output: null },
		{ code: '<template><input type="range" /></template>', errors: [{ messageId: 'prefer', data: { tag: 'input', component: 'UISlider' } }], output: null },
		{ code: '<script lang="ts">const kind = "hidden";</script><template><input bind:type="kind" /></template>', errors: [{ messageId: 'prefer', data: { tag: 'input', component: 'UIInput' } }], output: null },
		{ code: '<template><textarea></textarea></template>', errors: [{ messageId: 'prefer', data: { tag: 'textarea', component: 'UITextarea' } }], output: null },
		{ code: '<template><select></select></template>', errors: [{ messageId: 'prefer', data: { tag: 'select', component: 'UISelect' } }], output: null },
		{ code: '<template><dialog></dialog></template>', errors: [{ messageId: 'prefer', data: { tag: 'dialog', component: 'UIModal' } }], output: null },
		{ code: '<template><table></table></template>', errors: [{ messageId: 'prefer', data: { tag: 'table', component: 'UITable' } }], output: null },
		{ code: '<template><UICard><snippet name="default"><div><button type="button">a</button></div></snippet></UICard></template>', errors: [{ messageId: 'prefer', data: { tag: 'button', component: 'UIButton' } }], output: null },
		{ code: '<template><table></table><button type="button">a</button></template>', options: [{ allow: ['table'] }], errors: [{ messageId: 'prefer', data: { tag: 'button', component: 'UIButton' } }], output: null },
	],
})

tester.run('no-autofocus', plugin.rules['no-autofocus'], {
	valid: [
		{ code: '<template><input /></template>' },
		{ code: '<template><Input autofocus /></template>' },
		{ code: '<template><x-editor autofocus></x-editor></template>' },
	],
	invalid: [
		{
			code: '<template><input autofocus></template>',
			errors: [{ messageId: 'unexpected', suggestions: [{ messageId: 'remove', output: '<template><input ></template>' }] }],
			output: null,
		},
	],
})
