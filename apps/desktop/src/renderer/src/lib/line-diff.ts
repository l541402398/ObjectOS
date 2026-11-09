/** Line-level LCS diff shared by the approval center and the review room. */
export type DiffLine = { type: 'add' | 'remove' | 'context'; text: string; oldLine: number | null; newLine: number | null }

export function lineDiff(before: string, after: string): DiffLine[] {
  const oldLines = before.split('\n')
  const newLines = after.split('\n')
  if (oldLines.length * newLines.length > 250_000) {
    return [
      ...oldLines.slice(0, 200).map((text, index) => ({ type: 'remove' as const, text, oldLine: index + 1, newLine: null })),
      ...newLines.slice(0, 200).map((text, index) => ({ type: 'add' as const, text, oldLine: null, newLine: index + 1 })),
    ]
  }
  const table = Array.from({ length: oldLines.length + 1 }, () => new Array<number>(newLines.length + 1).fill(0))
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i]![j] = oldLines[i] === newLines[j] ? (table[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(table[i + 1]?.[j] ?? 0, table[i]?.[j + 1] ?? 0)
    }
  }
  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'context', text: oldLines[i]!, oldLine: i + 1, newLine: j + 1 })
      i += 1
      j += 1
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      result.push({ type: 'remove', text: oldLines[i]!, oldLine: i + 1, newLine: null })
      i += 1
    } else {
      result.push({ type: 'add', text: newLines[j]!, oldLine: null, newLine: j + 1 })
      j += 1
    }
  }
  while (i < oldLines.length) {
    result.push({ type: 'remove', text: oldLines[i]!, oldLine: i + 1, newLine: null })
    i += 1
  }
  while (j < newLines.length) {
    result.push({ type: 'add', text: newLines[j]!, oldLine: null, newLine: j + 1 })
    j += 1
  }
  return result.slice(0, 400)
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.type === 'add') added += 1
    else if (line.type === 'remove') removed += 1
  }
  return { added, removed }
}
