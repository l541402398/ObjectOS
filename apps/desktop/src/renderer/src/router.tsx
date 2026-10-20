import { Suspense, lazy, type ReactNode } from 'react'
import { createHashRouter, Navigate } from 'react-router-dom'
import { EmptyState, LoadingBlock } from '@projectos/ui'
import AppLayout from './components/AppLayout'
import ProjectCenterPage from './pages/ProjectCenterPage'
import ProjectOverviewPage from './pages/ProjectOverviewPage'
import TaskBoardPage from './pages/TaskBoardPage'
import AgentWorkbenchPage from './pages/AgentWorkbenchPage'
import CollaborationPage from './pages/CollaborationPage'
import RunsPage from './pages/RunsPage'
import KnowledgePage from './pages/KnowledgePage'
import OperationsPage from './pages/OperationsPage'
import ResourcesPage from './pages/ResourcesPage'
import ApprovalsPage from './pages/ApprovalsPage'

const WorkspacePage = lazy(() => import('./pages/WorkspacePage'))
const OrchestrationPage = lazy(() => import('./features/orchestration/pages/OrchestrationWorkspace'))

function LazyPage({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="po-page">
          <LoadingBlock rows={8} label="正在加载工作台" />
        </div>
      }
    >
      {children}
    </Suspense>
  )
}

function NotFoundPage() {
  return (
    <div className="po-page">
      <EmptyState title="页面不存在" description="检查地址，或返回项目中心继续工作。" />
    </div>
  )
}

export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <ProjectCenterPage /> },
      {
        path: 'projects/:projectId',
        children: [
          { index: true, element: <ProjectOverviewPage /> },
          { path: 'tasks', element: <TaskBoardPage /> },
          { path: 'orchestration', element: <LazyPage><OrchestrationPage /></LazyPage> },
          { path: 'agents', element: <AgentWorkbenchPage /> },
          { path: 'collaboration', element: <CollaborationPage /> },
          { path: 'workspace', element: <LazyPage><WorkspacePage /></LazyPage> },
          { path: 'knowledge', element: <KnowledgePage /> },
          { path: 'operations', element: <OperationsPage /> },
          { path: 'resources', element: <ResourcesPage /> },
          { path: 'approvals', element: <ApprovalsPage /> },
          { path: 'runs', element: <RunsPage /> },
        ],
      },
      { path: 'settings', element: <Navigate to="/" replace /> },
      { path: 'settings/:section', element: <Navigate to="/" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])


