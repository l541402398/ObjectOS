import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { useReducedMotionPreference } from '../../../hooks/useReducedMotionPreference'
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  FolderLock,
  Laptop,
  Link2,
  Monitor,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react'
import type {
  LocalWorkerGrant,
  LocalWorkerView,
  OrganizationConnectionView,
  WorkerDesktopList,
} from '@projectos/contracts'
import {
  OrganizationEmpty,
  OrganizationError,
  OrganizationField,
  OrganizationLoading,
} from './OrganizationPrimitives'
import { organizationScopeKey } from './useOrganization'
import './workers.css'

const STATUS = {
  online: '在线',
  offline: '离线',
  paused: '已暂停',
  revoked: '已撤销',
  session_expired: '需重新登录',
}
const PLATFORM = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }
const grantStatus = (grant: LocalWorkerGrant, clock: number) =>
  grant.status === 'revoked'
    ? grant.remoteSynced
      ? '已撤销'
      : '本机已撤销 · 待同步'
    : grant.expiresAt <= clock
      ? '已过期'
      : grant.status === 'active'
        ? '已授权'
        : '待完成确认'
const when = (value: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value)

function WorkerStatus({
  worker,
  clock,
  unverified = false,
}: {
  worker: LocalWorkerView
  clock: number
  unverified?: boolean
}) {
  const stale =
    worker.state === 'active' &&
    (unverified || (worker.status === 'online' && (!worker.lastSeenAt || clock - worker.lastSeenAt > 20_000)))
  return (
    <span className={`ow-status is-${stale ? 'unverified' : worker.status}`}>
      <span aria-hidden />
      {stale ? '连接待确认' : STATUS[worker.status]}
    </span>
  )
}

function GrantForm({
  data,
  connection,
  pending,
  error,
  onCancel,
  onSave,
}: {
  data: WorkerDesktopList
  connection: OrganizationConnectionView
  pending: boolean
  error: unknown
  onCancel: () => void
  onSave: (input: Parameters<typeof window.projectos.organization.grantWorker>[0]) => void
}) {
  const projects = useQuery({
    queryKey: organizationScopeKey(connection, 'projects'),
    queryFn: () => window.projectos.organization.projects(),
    retry: false,
  })
  const first = useRef<HTMLSelectElement>(null)
  const [projectId, setProjectId] = useState(''),
    [localProjectId, setLocalProjectId] = useState('')
  const [directories, setDirectories] = useState('.'),
    [write, setWrite] = useState(false)
  const [hours, setHours] = useState(8),
    [budget, setBudget] = useState(20)
  useEffect(() => {
    first.current?.focus({ preventScroll: true })
  }, [])
  const eligible =
    projects.data?.projects.filter((p) => ['owner', 'maintainer', 'contributor'].includes(p.role)) ?? []
  const local = data.local.projects.find((p) => p.id === localProjectId)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave({
      projectId,
      localProjectId,
      durationHours: hours,
      scope: {
        directories: directories
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        tools: write ? ['list_directory', 'read_file', 'write_file'] : ['list_directory', 'read_file'],
        maxToolCalls: budget,
      },
    })
  }
  return (
    <form
      className="org-inline-form ow-grant-form"
      aria-label="关联本机项目"
      onSubmit={submit}
      data-testid="worker-grant-form"
    >
      <div className="org-form-heading">
        <h4>
          <Link2 size={16} aria-hidden />
          关联本机项目
        </h4>
        <button type="button" className="org-link" onClick={onCancel} disabled={pending}>
          取消
        </button>
      </div>
      <OrganizationError error={projects.error} />
      {projects.isError ? (
        <button type="button" className="org-button" onClick={() => void projects.refetch()}>
          重新读取共享项目
        </button>
      ) : null}
      <fieldset disabled={pending} className="ow-fields">
        <div className="org-form-grid">
          <OrganizationField label="共享项目">
            {(id) => (
              <select
                ref={first}
                id={id}
                value={projectId}
                required
                onChange={(e) => setProjectId(e.target.value)}
                data-testid="worker-shared-project"
              >
                <option value="">{projects.isPending ? '正在读取…' : '选择共享项目'}</option>
                {eligible.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </OrganizationField>
          <OrganizationField label="本机项目">
            {(id) => (
              <select
                id={id}
                value={localProjectId}
                required
                onChange={(e) => setLocalProjectId(e.target.value)}
                data-testid="worker-local-project"
              >
                <option value="">选择本机项目</option>
                {data.local.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </OrganizationField>
        </div>
        {local ? (
          <div className="ow-local-path">
            <FolderLock size={15} aria-hidden />
            <code>{local.rootPath}</code>
            <span>仅此设备可见</span>
          </div>
        ) : null}
        {!projects.isPending && !projects.isError && !eligible.length ? (
          <p className="org-message is-warning" role="status">
            当前没有可授权的共享项目。请联系项目负责人授予贡献者或更高权限。
          </p>
        ) : null}
        {!data.local.projects.length ? (
          <p className="org-message is-warning" role="status">
            请先在项目中心创建或导入本机项目，再进行关联。
          </p>
        ) : null}
        <div className="org-form-grid">
          <OrganizationField label="允许访问的目录" hint="每行一个项目内目录；. 表示整个项目。">
            {(id) => (
              <textarea
                id={id}
                rows={2}
                maxLength={3800}
                value={directories}
                required
                onChange={(e) => setDirectories(e.target.value)}
                data-testid="worker-directories"
                spellCheck={false}
              />
            )}
          </OrganizationField>
          <fieldset className="ow-permission">
            <legend>文件权限</legend>
            <label>
              <input
                type="radio"
                name="worker-permission"
                checked={!write}
                onChange={() => setWrite(false)}
              />
              只读<span>浏览目录、读取文件</span>
            </label>
            <label>
              <input type="radio" name="worker-permission" checked={write} onChange={() => setWrite(true)} />
              读取与写入<span>写入仍需逐次审批</span>
            </label>
          </fieldset>
        </div>
        <div className="org-form-grid">
          <OrganizationField label="授权时长">
            {(id) => (
              <select id={id} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                {[1, 4, 8, 24].map((h) => (
                  <option value={h} key={h}>
                    {h} 小时
                  </option>
                ))}
              </select>
            )}
          </OrganizationField>
          <OrganizationField label="工具调用上限">
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                max={100}
                step={1}
                required
                value={budget}
                onChange={(e) => setBudget(e.target.valueAsNumber)}
              />
            )}
          </OrganizationField>
        </div>
      </fieldset>
      <OrganizationError error={error} />
      <div className="ow-consent-footer">
        <span>
          <ShieldCheck size={15} aria-hidden />
          下一步将在系统窗口确认目录与权限
        </span>
        <button
          type="submit"
          className="org-button is-primary"
          disabled={
            pending || !projectId || !localProjectId || !directories.trim() || !Number.isInteger(budget)
          }
          data-testid="worker-grant-submit"
        >
          {pending ? '正在确认…' : '继续授权'}
          <ArrowUpRight size={15} aria-hidden />
        </button>
      </div>
    </form>
  )
}

export function OrganizationWorkers({ connection }: { connection: OrganizationConnectionView }) {
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [])
  const client = useQueryClient(),
    key = organizationScopeKey(connection, 'workers')
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [enrolling, setEnrolling] = useState(false),
    [granting, setGranting] = useState(false)
  const [name, setName] = useState('我的工作设备'),
    [notice, setNotice] = useState('')
  const [action, setAction] = useState<{
    worker: LocalWorkerView
    state: 'active' | 'paused' | 'revoked'
  } | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const addButton = useRef<HTMLButtonElement>(null),
    enrollInput = useRef<HTMLInputElement>(null),
    detailHeading = useRef<HTMLHeadingElement>(null)
  const reduce = useReducedMotionPreference()
  const query = useQuery({
    queryKey: key,
    queryFn: () => window.projectos.organization.workers(),
    retry: false,
    refetchInterval: enrolling || granting || action || revoking ? false : 15_000,
    refetchOnWindowFocus: false,
  })
  const save = useMutation({
    mutationFn: async (run: () => Promise<WorkerDesktopList>) => run(),
    onSuccess: (next) => {
      client.setQueryData(key, next)
      setEnrolling(false)
      setGranting(false)
      setAction(null)
    },
  })
  const revoke = useMutation({
    mutationFn: (grantId: string) => window.projectos.organization.revokeWorkerGrant({ grantId }),
    onSuccess: (result) => {
      setRevoking(null)
      setNotice(result.remoteSynced ? '授权已撤销。' : '本机授权已撤销；联网后同步撤销记录。')
      client.setQueryData<WorkerDesktopList>(key, (data) =>
        data
          ? {
              ...data,
              local: {
                ...data.local,
                grants: data.local.grants.map((g) =>
                  g.id === revoking ? { ...g, status: 'revoked', remoteSynced: result.remoteSynced } : g,
                ),
              },
            }
          : data,
      )
      void query.refetch()
    },
  })
  useEffect(() => {
    if (enrolling) enrollInput.current?.focus({ preventScroll: true })
  }, [enrolling])
  useEffect(() => {
    if (selectedId) detailHeading.current?.focus({ preventScroll: true })
  }, [selectedId])
  const data = query.data,
    current = data?.workers.find((w) => w.id === data.currentWorkerId),
    selected = data?.workers.find((w) => w.id === selectedId)
  const pending = save.isPending || revoke.isPending
  const reset = () => {
    save.reset()
    revoke.reset()
    setNotice('')
  }
  const closeForm = () => {
    setGranting(false)
    reset()
    addButton.current?.focus({ preventScroll: true })
  }

  return (
    <section
      className="ow-workspace"
      aria-label="本机执行端"
      data-testid="organization-workers"
      aria-busy={query.isPending || pending}
    >
      <div className="org-section-heading">
        <div>
          <h3>执行端</h3>
          <p>设备由所属成员管理，本机目录需要单独授权。</p>
        </div>
        <div className="org-inline-actions">
          <button
            className="org-button ow-refresh"
            type="button"
            aria-label="刷新设备"
            onClick={() => void query.refetch()}
            disabled={query.isFetching || pending}
          >
            <RefreshCw size={15} aria-hidden />
          </button>
          {!current || current.state === 'revoked' || current.status === 'session_expired' ? (
            <button
              ref={addButton}
              type="button"
              className="org-button is-primary"
              disabled={pending}
              onClick={() => {
                reset()
                setEnrolling(!enrolling)
                setGranting(false)
              }}
              aria-expanded={enrolling}
              data-testid="worker-enroll"
            >
              <Plus size={15} aria-hidden />
              {current?.status === 'session_expired' ? '重新登记' : '登记此设备'}
            </button>
          ) : null}
        </div>
      </div>
      {enrolling ? (
        <form
          className="org-inline-form ow-enroll"
          aria-label="登记此设备"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(() => window.projectos.organization.enrollWorker({ name }), {
              onSuccess: () => setNotice('此设备已登记。目录访问需要另行授权。'),
            })
          }}
        >
          <OrganizationField label="设备名称">
            {(id) => (
              <input
                ref={enrollInput}
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                required
                disabled={pending}
                data-testid="worker-name"
              />
            )}
          </OrganizationField>
          <div className="org-inline-actions">
            <button
              type="button"
              className="org-button"
              disabled={pending}
              onClick={() => {
                setEnrolling(false)
                addButton.current?.focus()
              }}
            >
              取消
            </button>
            <button
              type="submit"
              className="org-button is-primary"
              disabled={pending || !name.trim()}
              data-testid="worker-enroll-submit"
            >
              {save.isPending ? '正在登记…' : '确认登记'}
            </button>
          </div>
        </form>
      ) : null}
      <OrganizationError error={query.error} />
      {query.isError ? (
        <button type="button" className="org-button" onClick={() => void query.refetch()}>
          重新读取设备
        </button>
      ) : null}
      {query.isPending ? (
        <OrganizationLoading />
      ) : data ? (
        <>
          {selected ? (
            <motion.div
              className="ow-device-detail"
              initial={reduce ? false : { y: 4 }}
              animate={{ y: 0 }}
              transition={{ duration: 0.18 }}
            >
              <button
                type="button"
                className="org-link ow-back"
                onClick={() => {
                  setSelectedId(null)
                  setGranting(false)
                  setAction(null)
                  reset()
                }}
              >
                <ArrowLeft size={14} aria-hidden />
                所有设备
              </button>
              <div className="ow-device-heading">
                <span className="ow-device-symbol">
                  <Laptop size={24} strokeWidth={1.5} aria-hidden />
                </span>
                <div>
                  <h4 ref={detailHeading} tabIndex={-1}>
                    {selected.name}
                    {selected.id === data.currentWorkerId ? (
                      <span className="ow-local-tag">此设备</span>
                    ) : null}
                  </h4>
                  <p>
                    {PLATFORM[selected.platform]}
                    <span aria-hidden> / </span>
                    {selected.ownerName}
                  </p>
                </div>
                <WorkerStatus worker={selected} clock={clock} unverified={query.isError} />
              </div>
              <dl className="ow-facts">
                <div>
                  <dt>连接状态</dt>
                  <dd>{selected.lastSeenAt ? `最近连接 ${when(selected.lastSeenAt)}` : '尚未建立心跳'}</dd>
                </div>
                <div>
                  <dt>任务接收</dt>
                  <dd>尚未启用</dd>
                </div>
                <div>
                  <dt>设备标识</dt>
                  <dd>
                    <code>{selected.id.slice(0, 8)}</code>
                  </dd>
                </div>
              </dl>
              {selected.canManage && selected.state !== 'revoked' ? (
                <div className="ow-device-actions">
                  {selected.id === data.currentWorkerId || selected.state === 'active' ? (
                    <button
                      type="button"
                      className="org-button"
                      disabled={pending}
                      onClick={() => {
                        reset()
                        setAction({
                          worker: selected,
                          state: selected.state === 'active' ? 'paused' : 'active',
                        })
                        setGranting(false)
                      }}
                      data-testid="worker-pause"
                    >
                      {selected.state === 'active' ? '暂停设备' : '恢复连接'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="org-link is-danger"
                    disabled={pending}
                    onClick={() => {
                      reset()
                      setAction({ worker: selected, state: 'revoked' })
                      setGranting(false)
                    }}
                    data-testid="worker-remove"
                  >
                    撤销设备登记
                  </button>
                </div>
              ) : null}
            </motion.div>
          ) : data.workers.length ? (
            <div className="org-table-wrap ow-device-table">
              <table className="org-table">
                <caption className="org-sr-only">当前组织的登记设备及真实连接状态</caption>
                <thead>
                  <tr>
                    <th scope="col">设备</th>
                    <th scope="col">连接</th>
                    <th scope="col">所属成员</th>
                    <th scope="col">
                      <span className="org-sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.workers.map((worker) => (
                    <tr key={worker.id}>
                      <td>
                        <div className="org-item-identity">
                          <span
                            className={`org-row-icon ${worker.id === data.currentWorkerId ? 'is-local' : ''}`}
                          >
                            <Monitor size={18} aria-hidden />
                          </span>
                          <div>
                            <strong>
                              {worker.name}
                              {worker.id === data.currentWorkerId ? (
                                <span className="ow-local-tag">此设备</span>
                              ) : null}
                            </strong>
                            <span className="org-item-sub">{PLATFORM[worker.platform]}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <WorkerStatus worker={worker} clock={clock} unverified={query.isError} />
                      </td>
                      <td>
                        <span className="ow-owner">{worker.ownerName}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="org-link"
                          aria-label={`查看 ${worker.name}`}
                          onClick={() => {
                            reset()
                            setSelectedId(worker.id)
                          }}
                          data-testid={`worker-open-${worker.id}`}
                        >
                          查看
                          <ChevronRight size={14} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <OrganizationEmpty title="连接你的第一台设备">
              登记工作设备后，可为共享项目关联本机目录。
            </OrganizationEmpty>
          )}
          {action ? (
            <div className="org-inline-confirm" role="group" aria-label="确认设备变更">
              <p>
                {action.state === 'active'
                  ? '恢复此设备的连接。此前的目录授权需要重新创建。'
                  : action.state === 'paused'
                    ? '暂停后立即撤销此设备的项目授权。恢复连接后需重新授权。'
                    : '撤销设备登记及其全部项目授权。此操作无法恢复。'}
              </p>
              <div className="org-inline-actions">
                <button
                  type="button"
                  className="org-button"
                  disabled={pending}
                  onClick={() => setAction(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={`org-button ${action.state === 'active' ? 'is-primary' : 'is-danger'}`}
                  disabled={pending}
                  onClick={() =>
                    save.mutate(() =>
                      window.projectos.organization.changeWorker({
                        workerId: action.worker.id,
                        expectedRevision: action.worker.revision,
                        state: action.state,
                      }),
                    )
                  }
                  data-testid="worker-state-confirm"
                >
                  {pending ? '正在处理…' : '确认'}
                </button>
              </div>
            </div>
          ) : null}
          {!selected || selected.id === data.currentWorkerId ? (
            <div className="ow-local-section">
              <div className="org-section-heading">
                <div>
                  <h4>
                    <FolderLock size={16} aria-hidden />
                    本机项目授权
                  </h4>
                  <p>仅此设备可见的目录关联，可随时撤销。</p>
                </div>
                {current?.state === 'active' && current.status !== 'session_expired' && !enrolling ? (
                  <button
                    ref={addButton}
                    type="button"
                    className="org-button"
                    disabled={pending}
                    onClick={() => {
                      reset()
                      setGranting(!granting)
                      setAction(null)
                    }}
                    aria-expanded={granting}
                    data-testid="worker-link"
                  >
                    <Link2 size={14} aria-hidden />
                    关联项目
                  </button>
                ) : null}
              </div>
              {granting ? (
                <GrantForm
                  data={data}
                  connection={connection}
                  pending={pending}
                  error={save.error}
                  onCancel={closeForm}
                  onSave={(input) =>
                    save.mutate(() => window.projectos.organization.grantWorker(input), {
                      onSuccess: () => {
                        setNotice('项目已关联，授权范围已保存。')
                        addButton.current?.focus({ preventScroll: true })
                      },
                    })
                  }
                />
              ) : null}
              {data.local.grants.length ? (
                <ul className="ow-grants" aria-label="本机项目授权记录">
                  {data.local.grants.map((grant) => (
                    <li
                      key={grant.id}
                      className={grant.status === 'revoked' || grant.expiresAt <= clock ? 'is-inactive' : ''}
                    >
                      <div className="ow-grant-title">
                        <div>
                          <strong>
                            {data.grants.find((g) => g.id === grant.id)?.projectName ?? '共享项目'}
                            <ChevronRight size={13} aria-hidden />
                            {grant.localProjectName}
                          </strong>
                          <span className="ow-grant-state">{grantStatus(grant, clock)}</span>
                        </div>
                        {grant.status !== 'revoked' ? (
                          <button
                            type="button"
                            className="org-link is-danger"
                            disabled={pending}
                            onClick={() => {
                              reset()
                              setRevoking(grant.id)
                            }}
                            aria-label={`撤销 ${grant.localProjectName} 的授权`}
                            data-testid={`worker-revoke-${grant.id}`}
                          >
                            撤销授权
                          </button>
                        ) : (
                          <Check size={15} aria-label="本机权限已撤销" />
                        )}
                      </div>
                      <code className="ow-grant-path">{grant.rootPath}</code>
                      <div className="ow-grant-scope">
                        <span>
                          <ShieldCheck size={13} aria-hidden />
                          {grant.scope.tools.includes('write_file') ? '读取与写入 · 写入需审批' : '只读'}
                        </span>
                        <span>
                          <Clock3 size={13} aria-hidden />
                          {when(grant.expiresAt)} 到期
                        </span>
                        <span>{grant.scope.maxToolCalls} 次调用上限</span>
                      </div>
                      <div className="ow-directory-list">
                        {grant.scope.directories.map((directory) => (
                          <code key={directory}>{directory === '.' ? '整个项目' : directory}</code>
                        ))}
                      </div>
                      {revoking === grant.id ? (
                        <div className="org-inline-confirm" role="group" aria-label="确认撤销项目授权">
                          <p>撤销后，此关联不能再用于访问本机目录。</p>
                          <div className="org-inline-actions">
                            <button
                              type="button"
                              className="org-button"
                              disabled={pending}
                              onClick={() => setRevoking(null)}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              className="org-button is-danger"
                              disabled={pending}
                              onClick={() => revoke.mutate(grant.id)}
                              data-testid="worker-revoke-confirm"
                            >
                              {revoke.isPending ? '正在撤销…' : '确认撤销'}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : !granting ? (
                <div className="ow-unlinked">
                  <span>
                    <FolderLock size={20} strokeWidth={1.5} aria-hidden />
                  </span>
                  <div>
                    <strong>本机目录尚未授权</strong>
                    <p>选择共享项目与本机项目，并确认允许访问的范围。</p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="org-boundary-note">本机目录与授权详情仅在设备所属成员的本机查看。</p>
          )}
        </>
      ) : null}
      {!granting ? <OrganizationError error={save.error} /> : null}
      <OrganizationError error={revoke.error} />
      {notice ? (
        <p className="org-message ow-notice" role="status">
          <Check size={16} aria-hidden />
          <span>{notice}</span>
          <button type="button" className="org-link" aria-label="关闭操作提示" onClick={() => setNotice('')}>
            <X size={14} aria-hidden />
          </button>
        </p>
      ) : null}
    </section>
  )
}
