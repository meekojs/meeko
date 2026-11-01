import { spawnSync } from 'node:child_process'

import { repositoryPath, repositoryRoot } from '../content/repository'
import { contentHash, normalizeSourcePath, normalizeText } from './overlay'

/** Options of {@link findGitVersion}. */
export interface FindGitVersionOptions {
	/** Commits of the file's history that are read, newest first; 100 by default. */
	readonly limit?: number
	/** Milliseconds each `git` command may take; 10 s by default. */
	readonly timeoutMs?: number
}

/** A version of a file found in the history of Git. */
export interface GitVersion {
	/** The commit that has it. */
	readonly commit: string
	/** Its text, with `\n` line endings. */
	readonly text: string
}

const commitPattern = /^[0-9a-f]{40}$/

/**
 * The text of a repository file whose {@link contentHash} is `hash`, searched in the last commits
 * that changed the file (`git log`), or `null` when none has it. It reads the history only: a
 * version that never reached a commit, such as an import of an uncommitted working tree, is not
 * found. It never writes to the repository: every command runs with `--no-optional-locks`.
 */
export function findGitVersion(file: string, hash: string, options: FindGitVersionOptions = {}): GitVersion | null {
	if (!/^[0-9a-f]{64}$/.test(hash)) throw new TypeError('The hash must be a SHA-256 in hexadecimal')
	const path = repositoryPath(normalizeSourcePath(file))
	const limit = options.limit ?? 100
	if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('The limit must be a positive integer')
	const git = (args: readonly string[], input?: string) => spawnSync('git', ['--no-optional-locks', ...args], { cwd: repositoryRoot(), windowsHide: true, timeout: options.timeoutMs ?? 10_000, maxBuffer: 64 * 1024 * 1024, ...(input === undefined ? {} : { input }) })
	const log = git(['log', `-n${limit}`, '--format=%H', '--', path])
	if (log.status !== 0) return null
	const commits = log.stdout
		.toString('utf8')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => commitPattern.test(line))
	if (!commits.length) return null
	// One process reads every version: `git cat-file --batch` answers each `<commit>:<path>` line
	// with `<object> blob <size>\n<content>\n`, or `<name> missing\n`.
	const batch = git(['cat-file', '--batch'], commits.map((commit) => `${commit}:${path}\n`).join(''))
	if (batch.status !== 0) return null
	const output = batch.stdout
	let at = 0
	for (const commit of commits) {
		const end = output.indexOf(0x0a, at)
		if (end < 0) break
		const header = output.subarray(at, end).toString('utf8').split(' ')
		at = end + 1
		if (header[1] !== 'blob') continue
		const size = Number(header[2])
		const text = normalizeText(output.subarray(at, at + size).toString('utf8'))
		at += size + 1
		if (contentHash(text) === hash) return { commit, text }
	}
	return null
}
