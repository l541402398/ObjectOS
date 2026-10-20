import { createHash } from 'node:crypto'

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const FAILURE_LINE = /\b(error|errors|fail|failed|failure|assertion|expected|exception|TS\d{4}|ERR_[A-Z_]+)\b|[✗×✖]/i
const MAX_SIGNATURE_LINES = 20

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Removes everything that changes between identical failures: colors, the project root,
 * absolute paths, timestamps, durations, hashes and counters.
 */
export function normalizeOutput(output: string, rootPath: string): string {
  let text = output.replace(ANSI, '').replace(/\r\n?/g, '\n')
  for (const root of new Set([rootPath, rootPath.replace(/\\/g, '/')])) {
    if (root) text = text.replace(new RegExp(escapeRegExp(root), 'gi'), '')
  }
  return text
    .replace(/\\/g, '/')
    .replace(/(?:[A-Za-z]:)?\/(?:[^\s:'"()]+\/)+/g, '')
    .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, '<time>')
    .replace(/\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/g, '<time>')
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|m|min)\b/gi, '<dur>')
    .replace(/\b[0-9a-f]{7,40}\b/gi, '<hash>')
    .replace(/[ \t]+/g, ' ')
}

/** Stable failure signature: the normalized failure lines, or the exit code when none are recognizable. */
export function failureSignature(output: string, rootPath: string, exitCode: number | null): string {
  const lines = normalizeOutput(output, rootPath)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && FAILURE_LINE.test(line))
    // Counters ("3 failed | 12 passed") vary with unrelated tests; keep the wording only.
    .map((line) => line.replace(/\b\d+\b/g, '#'))
  const unique = [...new Set(lines)].sort().slice(0, MAX_SIGNATURE_LINES)
  return unique.length ? unique.join('\n') : `exit:${exitCode ?? 'none'}`
}

export function findingFingerprint(projectId: string, checkId: string, signature: string): string {
  return hash(`${projectId}:${checkId}:${hash(signature)}`)
}
