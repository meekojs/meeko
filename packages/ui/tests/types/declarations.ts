import type * as App from '../../dist/app/components/App.d.meeko.ts'
import type * as Button from '../../dist/app/components/Button.d.meeko.ts'
import type * as Card from '../../dist/app/components/Card.d.meeko.ts'
import type * as Field from '../../dist/app/components/Field.d.meeko.ts'
import type * as Input from '../../dist/app/components/Input.d.meeko.ts'
import type * as InternalModal from '../../dist/app/components/internal/ModalInstance.d.meeko.ts'
import type * as Modal from '../../dist/app/components/Modal.d.meeko.ts'
import type * as Table from '../../dist/app/components/Table.d.meeko.ts'

type Components = [App.ComponentProps, Button.ComponentProps, Card.ComponentProps, Field.ComponentProps, Input.ComponentProps, Modal.ComponentProps, Table.ComponentProps<{ id: number }>, InternalModal.ComponentProps]
const modal: Modal.ComponentProps = {
	title: 'Confirm',
	onDismiss: (reason) => {
		const checked: 'escape' | 'backdrop' | 'button' | 'native' = reason
		void checked
	},
}
const wrong: Modal.ComponentProps = {
	title: 'Confirm',
	// @ts-expect-error The event argument remains typed after declaration relocation.
	onDismiss: (reason: number) => {
		void reason
	},
}
export type { Components }
void [modal, wrong]
