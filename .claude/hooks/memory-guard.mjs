// Hook PreToolUse (Bash y PowerShell): red de seguridad contra el agotamiento de la memoria comprometida.
// Si la memoria comprometida libre baja del umbral, bloquea órdenes nuevas de Node (node, pnpm, npx, tsx...)
// y lista los procesos con más memoria privada. Solo consulta el sistema cuando la orden lanza Node.
//
// Variables de entorno:
// - MEEKO_MEMORY_GUARD_MIN_FREE_PERCENT: umbral en % de la memoria comprometida libre (10 por defecto; 0 lo desactiva).
// - MEEKO_MEMORY_GUARD_SAMPLE: muestra simulada en JSON `{ freeKb, totalKb, processes? }` para pruebas.
import { spawnSync } from 'node:child_process'
import { freemem, totalmem } from 'node:os'

import { deny, readHookInput, visitSegments } from './shell.mjs'

const NODE_COMMANDS = new Set(['corepack', 'node', 'npm', 'npx', 'pnpm', 'pnpx', 'tsx', 'vite', 'vitest'])
const DEFAULT_THRESHOLD = 10
const QUERY_TIMEOUT_MS = 5000

// Win32_OperatingSystem: TotalVirtualMemorySize es el límite de memoria comprometida y FreeVirtualMemory
// lo que queda disponible (ambos en KB). La lista de procesos solo se calcula cuando hay que bloquear.
const WINDOWS_QUERY = `
$ErrorActionPreference = 'Stop'
$os = Get-CimInstance Win32_OperatingSystem -Property FreeVirtualMemory,TotalVirtualMemorySize
$free = [double]$os.FreeVirtualMemory
$total = [double]$os.TotalVirtualMemorySize
$processes = @()
if ($total -gt 0 -and ($free / $total * 100) -lt [double]$env:MEEKO_MEMORY_GUARD_MIN_FREE_PERCENT) {
	$processes = @(Get-Process | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First 8 | ForEach-Object {
		@{ commandLine = $_.CommandLine; name = $_.ProcessName; pid = $_.Id; privateBytes = $_.PrivateMemorySize64 }
	})
}
@{ freeKb = $free; processes = $processes; totalKb = $total } | ConvertTo-Json -Compress -Depth 4
`

/**
 * Indica si la orden lanza un proceso de Node.
 * @param {string} command
 * @param {string} cwd
 */
export function launchesNode(command, cwd) {
	let found = false
	visitSegments(command, cwd, (segment) => {
		if (NODE_COMMANDS.has(segment.name)) found = true
	})
	return found
}

/**
 * Lee la memoria comprometida del sistema. Devuelve `null` si no se puede medir.
 * @param {number} threshold
 * @returns {{ freeKb: number, processes?: { commandLine?: string, name: string, pid: number, privateBytes: number }[], totalKb: number, unavailable?: boolean } | null}
 */
export function sampleMemory(threshold) {
	const simulated = process.env.MEEKO_MEMORY_GUARD_SAMPLE
	if (simulated) return JSON.parse(simulated)
	if (process.platform !== 'win32') return { freeKb: freemem() / 1024, totalKb: totalmem() / 1024 }
	const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_QUERY, 'utf16le').toString('base64')], {
		encoding: 'utf8',
		env: { ...process.env, MEEKO_MEMORY_GUARD_MIN_FREE_PERCENT: String(threshold) },
		timeout: QUERY_TIMEOUT_MS,
		windowsHide: true,
	})
	// Si ni siquiera se puede lanzar la consulta por falta de memoria, el sistema ya está agotado.
	if (result.error?.code === 'ENOMEM' || /OutOfMemory|out of memory/i.test(result.stderr ?? '')) return { freeKb: 0, totalKb: 0, unavailable: true }
	if (result.error || result.status !== 0) return null
	try {
		return JSON.parse(result.stdout)
	} catch {
		return null
	}
}

/**
 * Devuelve el motivo de bloqueo según la muestra de memoria, o `null` si hay margen suficiente.
 * @param {ReturnType<typeof sampleMemory>} sample
 * @param {number} threshold
 */
export function memoryReason(sample, threshold) {
	if (!sample) return null
	const lines = []
	if (sample.unavailable) {
		lines.push('Bloqueado por .claude/hooks/memory-guard.mjs: no se pudo ni medir la memoria del sistema por falta de memoria.')
	} else {
		if (!(sample.totalKb > 0)) return null
		const percent = (sample.freeKb / sample.totalKb) * 100
		if (percent >= threshold) return null
		lines.push(`Bloqueado por .claude/hooks/memory-guard.mjs: la memoria comprometida libre es ${gigabytes(sample.freeKb * 1024)} de ${gigabytes(sample.totalKb * 1024)} (${percent.toFixed(1)} %), por debajo del umbral del ${threshold} %.`)
	}
	lines.push('No lances procesos nuevos de node, pnpm, npx ni tsx hasta liberar memoria; con el sistema agotado fallan git, PowerShell y los propios agentes.')
	const processes = sample.processes ?? []
	if (processes.length) {
		lines.push('Procesos con más memoria privada:')
		for (const entry of processes) {
			const commandLine = entry.commandLine ? ` — ${truncate(entry.commandLine.replace(/\s+/g, ' '), 160)}` : ''
			lines.push(`- ${entry.name} (PID ${entry.pid}): ${gigabytes(entry.privateBytes)}${commandLine}`)
		}
	}
	lines.push('Cierra solo los procesos que hayas lanzado tú (`Stop-Process -Id <PID>`) y avisa al coordinador del resto. --max-old-space-size no limita la memoria nativa (Tailwind/oxide, Vite): revisa que ningún proceso haya cambiado el cwd o esté escaneando fuera de la raíz del proyecto.')
	return lines.join('\n')
}

function gigabytes(bytes) {
	return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function truncate(text, length) {
	return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

if (import.meta.main) {
	const threshold = Number(process.env.MEEKO_MEMORY_GUARD_MIN_FREE_PERCENT ?? DEFAULT_THRESHOLD)
	const input = readHookInput()
	if (input && threshold > 0 && launchesNode(input.command, input.cwd)) {
		const reason = memoryReason(sampleMemory(threshold), threshold)
		if (reason) deny(reason)
	}
}
