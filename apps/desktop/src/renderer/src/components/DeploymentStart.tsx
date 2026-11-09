import { ArrowRight, Check, CloudUpload, Layers3, PackageCheck, Server } from 'lucide-react'
import { Button } from 'antd'

/** Setup is a real prerequisite projection, never a fictional deployment progress display. */
export function DeploymentStart({ releaseCount, releaseVersion, environmentName, environmentCount, targetCount, onRelease, onEnvironment, onTarget, onDeploy }: {
  releaseCount: number
  releaseVersion?: string
  environmentName?: string
  environmentCount: number
  targetCount: number
  onRelease: () => void
  onEnvironment: () => void
  onTarget: () => void
  onDeploy: () => void
}) {
  const next = releaseCount === 0 ? 'release' : environmentCount === 0 ? 'environment' : targetCount === 0 ? 'target' : 'deploy'
  return <section className="dc-start" aria-label="部署准备">
    <div className="dc-start-hero">
      <div className="dc-start-copy">
        <span className="dc-start-icon"><CloudUpload size={20} strokeWidth={1.6} /></span>
        <h2>{next === 'release' ? '先准备一次可交付的发布' : next === 'environment' ? '选择这次交付的环境' : next === 'target' ? '为发布连接一个部署目标' : '准备好，将发布交付到环境'}</h2>
        <p>{next === 'release' ? '完成发布审核后，在这里选择环境并发起部署。' : next === 'environment' ? '环境区分测试与生产，目标是实际服务器或目录。' : next === 'target' ? `${environmentName ?? '当前环境'}已就绪，连接服务器或目录后即可部署。` : '创建请求 → 审批 → 执行并验证。'}</p>
        <Button type="primary" onClick={next === 'release' ? onRelease : next === 'environment' ? onEnvironment : next === 'target' ? onTarget : onDeploy}>
          {next === 'release' ? '前往发布中心' : next === 'environment' ? '登记环境' : next === 'target' ? '连接部署目标' : '登记部署'}<ArrowRight size={15} />
        </Button>
      </div>
    </div>
    <ol className="dc-readiness" aria-label="部署前提">
      {[
        { key: 'release', title: '发布包', icon: PackageCheck, ready: releaseCount > 0, value: releaseCount ? `${releaseCount} 个可用发布包${releaseVersion ? ` · v${releaseVersion}` : ''}` : '尚未生成', detail: '经过审核的版本成果', action: '查看发布', run: onRelease },
        { key: 'environment', title: '部署环境', icon: Layers3, ready: environmentCount > 0, value: environmentCount ? `${environmentCount} 个环境 · ${environmentName ?? '待选择'}` : '尚未登记', detail: '区分本地、测试或生产用途', action: '登记环境', run: onEnvironment },
        { key: 'target', title: '实际目标', icon: Server, ready: targetCount > 0, value: targetCount ? `${targetCount} 个目标已登记` : '尚未连接', detail: '服务器、集群或本地目录', action: '连接部署目标', run: onTarget },
      ].map(({ key, title, icon: Icon, ready, value, detail, action, run }) => <li className={`dc-readiness-item${ready ? ' is-ready' : ''}${next === key ? ' is-next' : ''}`} key={key} aria-current={next === key ? 'step' : undefined}>
        <div className="dc-readiness-top"><span className="dc-step-node">{ready ? <Check size={16} /> : <Icon size={17} />}</span></div>
        <h3 title={detail}>{title}</h3><strong>{value}</strong>
        <button type="button" className="studio-link" onClick={run}>{action}<ArrowRight size={13} /></button>
      </li>)}
    </ol>
  </section>
}
