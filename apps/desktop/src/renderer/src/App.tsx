import { useEffect, useState } from 'react'

interface ProjectLite {
  id: string
  name: string
  stats: { tasksTotal: number; tasksDone: number; progress: number }
}

export default function App() {
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [error, setError] = useState('')
  const [projects, setProjects] = useState<ProjectLite[]>([])

  const load = (): void => {
    setState('loading')
    window.projectos.app
      .bootstrap()
      .then((result) => {
        setProjects(result.projects as unknown as ProjectLite[])
        setState('ready')
      })
      .catch((err: Error) => {
        setError(err.message)
        setState('error')
      })
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui' }}>
      <h1>ProjectOS</h1>
      {state === 'loading' && <p>正在启动本地 Runtime…</p>}
      {state === 'error' && (
        <div>
          <p>启动失败：{error}</p>
          <button onClick={load}>重试</button>
        </div>
      )}
      {state === 'ready' && (
        <ul>
          {projects.map((project) => (
            <li key={project.id}>
              {project.name} — {project.stats.tasksDone}/{project.stats.tasksTotal}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
