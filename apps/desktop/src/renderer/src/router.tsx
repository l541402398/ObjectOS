import { projectPageLoader } from './lib/route-readiness'
import { Suspense, lazy, type ReactNode } from 'react'
import { createHashRouter, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Button } from 'antd'
import { EmptyState, LoadingBlock } from '@projectos/ui'
import AppLayout from './components/AppLayout'
import { BootScreen } from './components/BootScreen'
import ProjectCenterPage from './pages/ProjectCenterPage'
import ProjectOverviewPage from './pages/ProjectOverviewPage'
import WorkCenterPage from './pages/WorkCenterPage'
import StudioProjectHome from './features/studio/StudioProjectHome'
import StudioReviewRoom from './features/studio/StudioReviewRoom'
import LifecyclePage from './pages/LifecyclePage'
import ReleaseCenterPage from './pages/ReleaseCenterPage'
import DeploymentCenterPage from './pages/DeploymentCenterPage'
import DeliveryResourcesPage from './pages/DeliveryResourcesPage'
import TaskBoardPage from './pages/TaskBoardPage'
import AgentWorkbenchPage from './pages/AgentWorkbenchPage'
import CollaborationPage from './pages/CollaborationPage'
import RunsPage from './pages/RunsPage'
import KnowledgePage from './pages/KnowledgePage'
import OperationsPage from './pages/OperationsPage'
import ResourcesPage from './pages/ResourcesPage'
import ApprovalsPage from './pages/ApprovalsPage'
import ProjectSettingsPage from './pages/ProjectSettingsPage'
import ProjectHealthPage from './pages/ProjectHealthPage'
import NotificationsPage from './pages/NotificationsPage'

const WorkspacePage = lazy(() => import('./pages/WorkspacePage'))
const OrchestrationPage = lazy(() => import('./features/orchestration/pages/OrchestrationWorkspace'))
const DesignLabPage = lazy(() => import('./features/design-lab/DesignLabPage'))
const PrecisionWorkspace = lazy(() => import('./features/precision/PrecisionWorkspace'))

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
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <div className="po-page">
      <EmptyState title="页面不存在" description="检查地址，或返回项目中心继续工作。" />
      <div className="po-notfound-actions">
        <code className="po-notfound-path">{location.pathname}</code>
        <Button size="small" onClick={() => navigate(-1)}>返回上一页</Button>
        <Button size="small" type="primary" onClick={() => navigate('/', { replace: true })}>回到项目中心</Button>
      </div>
    </div>
  )
}

export const router = createHashRouter([
  { path: 'design-lab', element: <LazyPage><DesignLabPage /></LazyPage> },
  { path: 'precision-lab', element: <LazyPage><PrecisionWorkspace /></LazyPage> },
  {
    path: '/',
    element: <AppLayout />,
    hydrateFallbackElement: <BootScreen />,
    children: [
      { index: true, loader: projectPageLoader('project-center'), element: <ProjectCenterPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      {
        path: 'projects/:projectId',
        children: [
          { index: true, loader: projectPageLoader('home'), element: <StudioProjectHome /> },
          { path: 'work', loader: projectPageLoader('work'), element: <WorkCenterPage /> },
          { path: 'versions', loader: projectPageLoader('versions'), element: <LifecyclePage /> },
          { path: 'releases', loader: projectPageLoader('releases'), element: <ReleaseCenterPage /> },
          { path: 'deployments', loader: projectPageLoader('deployments'), element: <DeploymentCenterPage /> },
          { path: 'connections', loader: projectPageLoader('connections'), element: <DeliveryResourcesPage /> },
          { path: 'overview', loader: projectPageLoader('overview'), element: <ProjectOverviewPage /> },
          { path: 'tasks', loader: projectPageLoader('tasks'), element: <TaskBoardPage /> },
          { path: 'orchestration', loader: projectPageLoader('orchestration'), element: <LazyPage><OrchestrationPage /></LazyPage> },
          { path: 'agents', loader: projectPageLoader('agents'), element: <AgentWorkbenchPage /> },
          { path: 'collaboration', loader: projectPageLoader('collaboration'), element: <CollaborationPage /> },
          { path: 'workspace', loader: projectPageLoader('workspace'), element: <LazyPage><WorkspacePage /></LazyPage> },
          { path: 'knowledge', loader: projectPageLoader('knowledge'), element: <KnowledgePage /> },
          { path: 'operations', loader: projectPageLoader('operations'), element: <OperationsPage /> },
          { path: 'resources', loader: projectPageLoader('resources'), element: <ResourcesPage /> },
          { path: 'approvals', loader: projectPageLoader('approvals'), element: <StudioReviewRoom /> },
          { path: 'approvals/center', loader: projectPageLoader('approval-center'), element: <ApprovalsPage /> },
          { path: 'project-settings', loader: projectPageLoader('project-settings'), element: <ProjectSettingsPage /> },
          { path: 'health', loader: projectPageLoader('health'), element: <ProjectHealthPage /> },
          { path: 'runs', loader: projectPageLoader('runs'), element: <RunsPage /> },
        ],
      },
      { path: 'settings', element: <Navigate to="/" replace /> },
      { path: 'settings/:section', element: <Navigate to="/" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
