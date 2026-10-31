// @ts-expect-error Package internals have no public entry point.
import type { createModalManager } from '@meekojs/ui/internal'
import type { ModalContext, ModalDismissReason, ModalInstanceContext } from '@meekojs/ui/runtime'
// @ts-expect-error Internal registry and resolver types are not public named exports.
import type { ModalArgs, ModalInstance, ModalName, ModalResolver } from '@meekojs/ui/runtime'
type _PrivateManager = typeof createModalManager

import { useModal, useModalInstance } from '@meekojs/ui/runtime'
// @ts-expect-error Internal helpers are not part of the public runtime.
import { provideModal } from '@meekojs/ui/runtime'
type _InternalTypes = [ModalArgs, ModalInstance, ModalName, ModalResolver]
void provideModal

const context: ModalContext = useModal()
const instanceContext: ModalInstanceContext<boolean> = useModalInstance<boolean>()
const reason: ModalDismissReason = 'escape'
void [context, instanceContext, reason]

declare module '@meekojs/meeko' {
	interface ComponentRegistry {
		ModalConfirm: { renderToString(props: { message: string }): string }
		ModalUserCreate: { renderToString(props: { organizationId: number }): string }
		Button: { renderToString(props: { label: string }): string }
	}
}

const modal = useModal()
const result: Promise<boolean | undefined> = modal.open<boolean>('ModalConfirm', { message: 'Continue?' })
void result
modal.open('ModalUserCreate', { organizationId: 1 })
// @ts-expect-error Only Modal-prefixed components can be opened.
modal.open('Button', { label: 'Save' })
// @ts-expect-error Props remain correlated with the selected component.
modal.open('ModalUserCreate', { message: 'Wrong' })
// @ts-expect-error Missing required prop.
modal.open('ModalConfirm', {})
// @ts-expect-error The result includes cancellation.
const requiredResult: Promise<boolean> = modal.open<boolean>('ModalConfirm', { message: 'Continue?' })
void requiredResult
const instance = useModalInstance<{ id: number }>()
instance.close({ id: 1 })
instance.dismiss()
// @ts-expect-error Result contracts are checked at the call site.
instance.close('wrong')
// @ts-expect-error Instance snapshots cannot be assigned by consumers.
modal.instances.value = new Map()
// @ts-expect-error Instance snapshots expose a read-only Map.
modal.instances.value.clear()
