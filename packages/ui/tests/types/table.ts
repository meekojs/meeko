import type { Snippet } from '@meekojs/meeko'
import type { TableColumn, TableRowKey } from '@meekojs/ui/runtime'

import type { ComponentProps, ComponentSnippets } from '../../dist/app/components/Table.d.meeko.ts'

interface User {
	id: number
	name: string
	age: number
	note?: string
	metadata: { active: boolean }
}

const columns = [
	{ key: 'name', label: 'Name', format: (value) => value.toUpperCase() },
	{ key: 'age', label: 'Age', format: (value, row) => value.toFixed(0) + row.name, footer: (rows) => rows.reduce((total, row) => total + row.age, 0) },
	{ key: 'note', label: 'Note', format: (value) => value?.toUpperCase() },
] satisfies TableColumn<User>[]

const props: ComponentProps<User> = { rows: [], columns, rowKey: 'id' }
const functionalKey: TableRowKey<User> = (row) => row.id
void [props, functionalKey]

// @ts-expect-error Column keys must exist in the row.
const badColumn: TableColumn<User> = { key: 'email', label: 'Email' }
// @ts-expect-error A numeric field's formatter receives a number.
const badFormatter: TableColumn<User> = { key: 'age', label: 'Age', format: (value: string) => value }
// @ts-expect-error Object-valued properties cannot identify rows.
const badKey: TableRowKey<User> = 'metadata'
// @ts-expect-error Optional properties cannot provide a stable identity.
const optionalKey: TableRowKey<User> = 'note'
// @ts-expect-error Rows are required.
const missingRows: ComponentProps<User> = { columns, rowKey: 'id' }
// @ts-expect-error Row shape remains checked against the selected type.
const badRows: ComponentProps<User> = { rows: [{ id: 'wrong' }], columns, rowKey: 'id' }
void [badColumn, badFormatter, badKey, optionalKey, missingRows, badRows]

// `cell-<clave>` recibe el valor con el tipo de esa columna y `header-<clave>`, la columna.
type Equal<A, B> = (<V>() => V extends A ? 1 : 2) extends <V>() => V extends B ? 1 : 2 ? true : false
type Snippets = ComponentSnippets<User>
const nameCell: Equal<NonNullable<Snippets['cell-name']>, Snippet<[row: User, value: string]>> = true
const ageCell: Equal<NonNullable<Snippets['cell-age']>, Snippet<[row: User, value: number]>> = true
const noteCell: Equal<NonNullable<Snippets['cell-note']>, Snippet<[row: User, value: string | undefined]>> = true
const ageHeader: Equal<NonNullable<Snippets['header-age']>, Snippet<[column: TableColumn<User>]>> = true
const optionalColumnSnippets: Equal<Pick<Snippets, 'cell-name'>, { 'cell-name'?: Snippet<[row: User, value: string]> }> = true
const fallbackCell: Equal<NonNullable<Snippets['cell']>, Snippet<[row: User, column: TableColumn<User>, value: User[keyof User], index: number]>> = true
// @ts-expect-error Column snippets exist only for keys of the row.
const missingCell: Snippets['cell-email'] = undefined
void [nameCell, ageCell, noteCell, ageHeader, optionalColumnSnippets, fallbackCell, missingCell]
