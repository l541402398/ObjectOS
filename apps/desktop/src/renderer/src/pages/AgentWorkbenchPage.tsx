import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { AgentStudioModal } from '../components/AgentStudioModal'
import { CollaborationOverview } from '../features/collaboration-overview/CollaborationOverview'
import { canonicalAgentSearch } from '../features/collaboration-overview/agent-context'
import { useSessions } from '../lib/queries'

/** Agent collaboration has one graph workspace. Legacy chat URLs resolve to graph-object context. */
export default function AgentWorkbenchPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const [searchParams,setSearchParams] = useSearchParams()
  const [studioOpen,setStudioOpen] = useState(false)
  const sessions = useSessions(projectId)
  const requestedSessionId = searchParams.get('session')
  const requestedAgentId = sessions.data?.sessions.find((item)=>item.id===requestedSessionId&&item.projectId===projectId)?.agentId??null
  useEffect(()=>{
    if(!searchParams.has('workspace')&&!searchParams.has('view'))return
    setSearchParams(canonicalAgentSearch(searchParams),{replace:true})
  },[searchParams,setSearchParams])
  const consumeRequest = useCallback(()=>{
    const next=canonicalAgentSearch(searchParams);next.delete('session');setSearchParams(next,{replace:true})
  },[searchParams,setSearchParams])
  return <>
    <CollaborationOverview projectId={projectId} onManageAgents={()=>setStudioOpen(true)} requestedAgentId={requestedAgentId} requestedSessionId={requestedSessionId} onContextRequestHandled={consumeRequest} />
    <AgentStudioModal open={studioOpen} onClose={()=>setStudioOpen(false)} projectId={projectId} />
  </>
}
