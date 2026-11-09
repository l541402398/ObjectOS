import { useMemo, useState, type ReactElement } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import type { DiffLine } from '../../lib/line-diff'

type Segment = { type: 'lines'; lines: DiffLine[] } | { type: 'fold'; lines: DiffLine[]; id: number }

const CONTEXT = 3

/** Split a diff into visible hunks and folded runs of unchanged lines. */
function segment(lines: DiffLine[]): Segment[] {
  const keep = lines.map(() => false)
  lines.forEach((line, index) => {
    if (line.type === 'context') return
    for (let k = Math.max(0, index - CONTEXT); k <= Math.min(lines.length - 1, index + CONTEXT); k += 1) keep[k] = true
  })
  const segments: Segment[] = []
  let fold = 0
  for (let index = 0; index < lines.length;) {
    const visible = keep[index]
    const start = index
    while (index < lines.length && keep[index] === visible) index += 1
    const run = lines.slice(start, index)
    if (visible || run.length <= 2) segments.push({ type: 'lines', lines: run })
    else segments.push({ type: 'fold', lines: run, id: fold++ })
  }
  return segments
}

export function ReviewDiff({ lines, label }: { lines: DiffLine[]; label: string }): ReactElement {
  const segments = useMemo(() => segment(lines), [lines])
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  const renderLine = (line: DiffLine, key: string): ReactElement => (
    <div key={key} className={`rv-diff-line is-${line.type}`}>
      <span className="rv-diff-num">{line.oldLine ?? ''}</span>
      <span className="rv-diff-num">{line.newLine ?? ''}</span>
      <span className="rv-diff-sign" aria-hidden>{line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ''}</span>
      <code>{line.text || ' '}</code>
    </div>
  )
  return (
    <div className="rv-diff" role="region" tabIndex={0} aria-label={label}>
      {segments.map((part, index) =>
        part.type === 'lines' || open.has(part.id) ? (
          part.lines.map((line, row) => renderLine(line, `${index}-${row}`))
        ) : (
          <button
            key={`fold-${part.id}`}
            type="button"
            className="rv-diff-fold"
            onClick={() => setOpen((current) => new Set(current).add(part.id))}
          >
            <ChevronsUpDown size={12} /> {part.lines.length} 行未改动
          </button>
        ),
      )}
    </div>
  )
}
