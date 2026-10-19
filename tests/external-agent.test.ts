import { describe, expect, it } from 'vitest'
import { externalCommand } from '../apps/runtime/src/external-runner.js'

describe('external agent command', () => {
  it('defaults to read-only plan mode and never grants edit tools', () => {
    const args = externalCommand('claude-code', '分析项目', false)
    expect(args).toContain('--print')
    expect(args).toContain('stream-json')
    expect(args).toContain('plan')
    expect(args).toContain('Read,Glob,Grep')
    expect(args).not.toContain('acceptEdits')
    expect(args).not.toContain('Write')
    expect(args.at(-1)).toBe('分析项目')
  })

  it('only enables write tools when explicitly requested', () => {
    const args = externalCommand('claude-code', '修改项目', true)
    expect(args).toContain('acceptEdits')
    expect(args).toContain('Read,Edit,Write,Glob,Grep')
  })
})
