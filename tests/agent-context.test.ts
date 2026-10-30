import { describe,expect,it } from 'vitest'
import { canonicalAgentSearch,chooseAgentContext } from '../apps/desktop/src/renderer/src/features/collaboration-overview/agent-context'

const sessions = [
  {id:'a-old',projectId:'p1',agentId:'a',updatedAt:1},
  {id:'a-new',projectId:'p1',agentId:'a',updatedAt:3},
  {id:'b-new',projectId:'p1',agentId:'b',updatedAt:9},
  {id:'a-other-project',projectId:'p2',agentId:'a',updatedAt:12},
]
describe('graph Agent execution context',()=>{
  it('keeps explicit context ahead of newer sessions, then active context ahead of history',()=>{
    expect(chooseAgentContext(sessions,'p1','a','a-old','a-new')?.id).toBe('a-old')
    expect(chooseAgentContext(sessions,'p1','a',null,'a-old')?.id).toBe('a-old')
    expect(chooseAgentContext(sessions,'p1','a',null,null)?.id).toBe('a-new')
  })
  it('never resolves a foreign Agent or project session from a legacy URL',()=>{
    expect(chooseAgentContext(sessions,'p1','a','b-new','a-other-project')?.id).toBe('a-new')
    expect(chooseAgentContext(sessions,'p3','a','a-old',null)).toBeNull()
  })
  it('removes the chat/pro workspace selectors while preserving context and graph links',()=>{
    const input=new URLSearchParams('workspace=sessions&view=pro&session=a-old&plan=real-plan')
    expect(canonicalAgentSearch(input).toString()).toBe('session=a-old&plan=real-plan')
    expect(input.get('workspace')).toBe('sessions')
  })
})
