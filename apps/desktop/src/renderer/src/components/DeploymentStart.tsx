import { ArrowRight, Check, CloudUpload, Layers3, MapPin, PackageCheck, Server } from 'lucide-react'
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
        <span className="dc-start-icon"><CloudUpload size={27} strokeWidth={1.5} /></span>
        <h2>{next === 'release' ? '先准备一次可交付的发布' : next === 'environment' ? '选择这次交付的环境' : next === 'target' ? '为发布连接一个部署目标' : '准备好，将发布交付到环境'}</h2>
        <p>{next === 'release' ? '当前版本还没有发布包。完成发布审核后，就能在这里选择环境并发起部署。' : next === 'environment' ? '环境区分测试、生产等用途；部署目标指定实际服务器或本地目录。' : next === 'target' ? `${environmentName ?? '当前环境'}已就绪，连接实际服务器或本地目录后即可申请部署。` : '创建部署请求后，先完成审批，再执行并验证结果。'}</p>
        <Button type="primary" size="large" onClick={next === 'release' ? onRelease : next === 'environment' ? onEnvironment : next === 'target' ? onTarget : onDeploy}>
          {next === 'release' ? '前往发布中心' : next === 'environment' ? '登记环境' : next === 'target' ? '连接部署目标' : '登记部署'}<ArrowRight size={15} />
        </Button>
      </div>
      <div className="dc-delivery-map" aria-label="发布与部署关系">
        <div className="dc-map-node"><PackageCheck size={20} /><span><small>交付什么</small><strong>{releaseVersion ? `v${releaseVersion} 发布包` : '待生成发布包'}</strong></span></div>
        <span className="dc-map-link" aria-hidden><i /><ArrowRight size={15} /></span>
        <div className="dc-map-destination"><MapPin size={20} /><span><small>交付到哪里</small><strong>{environmentName ?? '待选择环境'}</strong></span><div><Server size={15} />{targetCount ? `${targetCount} 个部署目标` : '待连接服务器或目录'}</div></div>
      </div>
    </div>
    <div className="dc-readiness">
      {[
        { key: 'release', title: '发布包', icon: PackageCheck, ready: releaseCount > 0, value: releaseCount ? `${releaseCount} 个可用发布包` : '尚未生成', detail: '经过审核的版本成果', action: '查看发布', run: onRelease },
        { key: 'environment', title: '部署环境', icon: Layers3, ready: environmentCount > 0, value: environmentCount ? `${environmentCount} 个环境 · ${environmentName ?? '待选择'}` : '尚未登记', detail: '区分本地、测试或生产用途', action: '登记环境', run: onEnvironment },
        { key: 'target', title: '实际目标', icon: Server, ready: targetCount > 0, value: targetCount ? `${targetCount} 个目标已登记` : '尚未连接', detail: '服务器、集群或本地目录', action: '连接部署目标', run: onTarget },
      ].map(({ key, title, icon: Icon, ready, value, detail, action, run }, index) => <article className={`dc-readiness-item${next === key ? ' is-next' : ''}`} key={key}>
        <div className="dc-readiness-top"><Icon size={19} /><span>{String(index + 1).padStart(2, '0')}</span>{ready ? <Check size={15} className="dc-ready-check" /> : null}</div>
        <h3>{title}</h3><strong>{value}</strong><p>{detail}</p>
        <button type="button" className="studio-link" onClick={run}>{action}<ArrowRight size={13} /></button>
      </article>)}
    </div>
  </section>
}
