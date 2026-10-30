import { useEffect, useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Plus, Send, Settings2, Square } from 'lucide-react'
import type { CollaborationOverviewAgent, RunStatus } from '@projectos/contracts'
import { qk, useAIConnections, useRuns, useSessionDetail, useSessions } from '../../lib/queries'
import { runStatusLabel } from '../../lib/labels'
import { errorMessage } from '../../lib/errors'
import { useUiStore } from '../../stores/ui'
import { chooseAgentContext } from './agent-context'

const ACTIVE: RunStatus[] = ['created','queued','running','waiting_tool','waiting_approval','verifying','suspended']

/** Compact graph-object actions. This is deliberately not a conversation view. */
export function AgentContextActions({ projectId, agent, preferredSessionId, onClose }: {
  projectId: string; agent: CollaborationOverviewAgent; preferredSessionId?: string | null; onClose: () => void
}) {
  const id = useId()
  const client = useQueryClient()
  const sessions = useSessions(projectId)
  const runs = useRuns(projectId,100)
  const connections = useAIConnections()
  const openSettings = useUiStore((state) => state.openSettings)
  const [selectedId, setSelectedId] = useState<string | null>(preferredSessionId ?? null)
  const [instruction, setInstruction] = useState('')
  const [receipt, setReceipt] = useState<string | null>(null)
  const choices = (sessions.data?.sessions ?? []).filter((session) => session.projectId === projectId && session.agentId === agent.id)
  const context = chooseAgentContext(choices,projectId,agent.id,selectedId,agent.activeSessionId)
  const contextId = context?.id ?? null
  const detail = useSessionDetail(context?.id,20)
  const run = (runs.data?.runs ?? []).filter((item) => item.sessionId === context?.id).sort((a,b) => b.createdAt-a.createdAt)[0] ?? null
  const active = Boolean(run && ACTIVE.includes(run.status))
  const agentBusy = active || Boolean(agent.runStatus && ACTIVE.includes(agent.runStatus))
  const provider = connections.data?.connections.find((item) => item.isDefault)
  const providerReady = Boolean(provider?.enabled && provider.hasSecret && provider.defaultModelId)
  const latestOutput = [...(detail.data?.messages ?? [])].reverse().find((item) => item.role === 'assistant')

  useEffect(() => { if(preferredSessionId) setSelectedId(preferredSessionId) },[preferredSessionId])
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({queryKey:qk.sessions(projectId)}),
      client.invalidateQueries({queryKey:qk.runs(projectId)}),
      client.invalidateQueries({queryKey:qk.collaborationOverview(projectId)}),
      client.invalidateQueries({queryKey:qk.approvals(projectId)}),
      ...(context ? [client.invalidateQueries({queryKey:qk.session(context.id)})] : []),
    ])
  }
  useEffect(() => window.projectos.runtime.onEvent(({event}) => {
    if(event.type==='runtime.log'||event.type==='run.delta')return
    void client.invalidateQueries({queryKey:qk.sessions(projectId)})
    void client.invalidateQueries({queryKey:qk.runs(projectId)})
    if(contextId)void client.invalidateQueries({queryKey:qk.session(contextId)})
  }),[client,contextId,projectId])
  const create = useMutation({mutationFn:async()=>{
    const result=await window.projectos.sessions.create({projectId,agentId:agent.id,title:`协作执行 · ${agent.name}`})
    setSelectedId(result.session.id);setReceipt('执行上下文已创建。');await refresh()
  }})
  const execute = useMutation({mutationFn:async()=>{
    if(!context)throw new Error('请先创建执行上下文。')
    const result=await window.projectos.sessions.sendMessage({sessionId:context.id,content:instruction.trim(),taskId:null,startRun:true})
    setInstruction('');setReceipt(result.warning || (result.runId ? '指令已提交，运行已启动。' : '指令已保存。'))
    await refresh()
  }})
  const stop = useMutation({mutationFn:async()=>{if(run){await window.projectos.runs.cancel(run.id);setReceipt('已请求停止运行。');await refresh()}}})
  const busy=create.isPending||execute.isPending||stop.isPending
  const error=create.error||execute.error||stop.error||sessions.error||detail.error

  return <section className="aco-context" aria-labelledby={`${id}-title`} data-testid="agent-context-actions">
    <div className="aco-context-heading"><h3 id={`${id}-title`}>执行指令</h3><button type="button" className="aco-link" data-testid="agent-context-create" disabled={busy} onClick={()=>create.mutate()}><Plus size={13} aria-hidden />新建上下文</button></div>
    <label className="aco-context-label" htmlFor={`${id}-session`}>执行上下文</label>
    <select id={`${id}-session`} data-testid="agent-context-session" value={context?.id??''} disabled={busy||choices.length===0} onChange={(event)=>{setSelectedId(event.target.value);setReceipt(null)}}>
      {choices.length===0?<option value="">尚无执行上下文</option>:choices.map((session)=><option key={session.id} value={session.id}>{session.title}</option>)}
    </select>
    {run?<div className="aco-context-run" role="status"><span>{runStatusLabel(run.status)}</span><code>{run.id}</code>{active?<button type="button" className="aco-link" data-testid="agent-context-cancel-run" disabled={busy} onClick={()=>stop.mutate()}><Square size={12} aria-hidden />停止运行</button>:null}</div>:null}
    <form onSubmit={(event)=>{event.preventDefault();execute.mutate()}}>
      <label className="aco-context-label" htmlFor={`${id}-prompt`}>给 {agent.name} 的指令</label>
      <textarea id={`${id}-prompt`} data-testid="agent-context-prompt" rows={3} maxLength={100_000} value={instruction} onChange={(event)=>setInstruction(event.target.value)} placeholder="输入本次执行目标或需要检查的内容" disabled={busy||agentBusy} required />
      {!providerReady?<button type="button" className="aco-link" onClick={()=>{onClose();openSettings('ai-connections')}}><Settings2 size={13} aria-hidden />配置 AI 连接后执行</button>:null}
      {agentBusy?<p className="aco-context-hint">该 Agent 有运行尚未结束，请等待或查看运行审计。</p>:!context?<p className="aco-context-hint">先创建执行上下文，再提交指令。</p>:<p className="aco-context-hint">文件写入与命令执行仍受工具审批约束。</p>}
      <div className="aco-context-actions"><button type="submit" className="aco-btn is-primary" data-testid="agent-context-submit" disabled={busy||agentBusy||!context||!providerReady||!instruction.trim()}><Send size={13} aria-hidden />{execute.isPending?'正在提交…':'执行指令'}</button></div>
    </form>
    {error?<p className="aco-context-error" role="alert"><CircleAlert size={14} aria-hidden />{errorMessage(error)}</p>:null}
    {receipt?<p className="aco-context-hint" role="status">{receipt}</p>:null}
    {latestOutput?<details className="aco-context-output"><summary>查看最近执行输出</summary><pre>{latestOutput.content.slice(0,6000)}</pre></details>:null}
  </section>
}
