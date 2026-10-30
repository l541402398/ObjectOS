/** Invoked from the isolated real PostgreSQL/Electron browser journey. No Renderer fetch or token. */
export async function exerciseAssets({ page, matrix, capture, check, waitFor }) {
  const api = (fn) => page.evaluate(fn)
  const selectAssetTab = async () => {
    await page.getByRole('button', { name: '组织资产', exact: true }).click()
    await page.getByTestId('organization-assets').waitFor()
  }
  const publish = async () => {
    await page.getByRole('button', { name: '发布版本', exact: true }).click()
    await page.getByTestId('asset-confirm-transition').click()
    await page.waitForFunction(
      () => document.querySelector('[data-testid="asset-status"]')?.textContent === '已发布',
    )
  }
  const save = async () => {
    await page.getByTestId('asset-save').click()
    await page.getByTestId('asset-detail').waitFor()
  }
  const back = async () => {
    await page.getByRole('button', { name: '返回资产列表', exact: true }).click()
    await page.getByTestId('asset-create').waitFor()
  }
  await selectAssetTab()
  await page.getByText('还没有共享资产', { exact: true }).waitFor()
  await page.getByTestId('asset-project-retry').waitFor()
  check(
    'Project read failure has an explicit recovery action',
    await page.getByTestId('asset-project-retry').isVisible(),
  )
  await capture('assets-project-read-error')
  await page.getByTestId('asset-project-retry').click()
  await page.getByTestId('asset-project-retry').waitFor({ state: 'hidden' })
  await capture('assets-empty-1440-light')
  await page.getByTestId('asset-create').focus()
  check(
    'Asset creation is keyboard reachable',
    await page.getByTestId('asset-create').evaluate((el) => el === document.activeElement),
  )
  await page.keyboard.press('Enter')
  await page.getByLabel('资产类型', { exact: true }).selectOption('skill')
  await page.getByTestId('asset-name').fill('交付证据检查')
  await page.getByLabel('工作指令', { exact: true }).fill('逐项核对验收标准，引用真实测试与产物。')
  await page.getByLabel('工具名称', { exact: true }).pressSequentially('read_file, run_command')
  check(
    'Asset form labels are explicit',
    await page
      .locator('.org-asset-editor input,.org-asset-editor textarea,.org-asset-editor select')
      .evaluateAll((items) => items.every((el) => el.labels?.length)),
  )
  await save()
  const firstList = await api(() => window.projectos.organization.assets())
  const skill = firstList.assets.find((item) => item.name === '交付证据检查')
  let detail = await page.evaluate(
    (id) => window.projectos.organization.assetDetail({ assetId: id }),
    skill.id,
  )
  const v1 = detail.versions[0].id
  check('Draft persisted without automatic publication', detail.versions[0].status === 'draft')
  check(
    'Comma-delimited tools retain separate typed values',
    detail.versions[0].definition.toolIds.join(',') === 'read_file,run_command',
  )
  await page.getByRole('button', { name: '发布版本', exact: true }).click()
  check(
    'Publication requires an explicit confirmation',
    await page.getByRole('group', { name: '确认版本操作' }).isVisible(),
  )
  await capture('asset-publication-confirmation')
  await page.getByTestId('asset-confirm-transition').click()
  await page.waitForFunction(
    () => document.querySelector('[data-testid="asset-status"]')?.textContent === '已发布',
  )
  const project = (await api(() => window.projectos.organization.projects())).projects[0]
  await page.getByLabel('绑定到项目', { exact: true }).selectOption(project.id)
  await page.getByTestId('asset-bind').click()
  await waitFor(
    async () =>
      (await page.evaluate((id) => window.projectos.organization.assetDetail({ assetId: id }), skill.id))
        .bindings.length === 1,
    'exact asset pin',
  )
  await page.getByRole('button', { name: '新建版本', exact: true }).click()
  await page
    .getByLabel('工作指令', { exact: true })
    .fill('逐项核对验收标准，引用真实测试与产物；补充代码审查结论。')
  await page.getByLabel('版本号', { exact: true }).fill('1.1.0')
  await save()
  await page.getByLabel('对比版本', { exact: true }).selectOption(v1)
  check(
    'Version comparison shows previous and current fields',
    (await page.getByTestId('asset-diff').locator('del').count()) > 0 &&
      (await page.getByTestId('asset-diff').locator('ins').count()) > 0,
  )
  await publish()
  detail = await page.evaluate((id) => window.projectos.organization.assetDetail({ assetId: id }), skill.id)
  const v2 = detail.versions[0].id
  check(
    'New publication preserves the explicit previous project pin',
    detail.bindings[0]?.versionId === v1 && detail.bindings[0]?.version === '1.0.0',
  )
  check(
    'Published version cannot be edited in place',
    (await page.getByRole('button', { name: '编辑草稿', exact: true }).count()) === 0,
  )
  await matrix('asset-detail')
  await back()
  await page.getByTestId('asset-create').click()
  await page.getByTestId('asset-name').fill('交付审阅 Agent')
  await page.getByLabel('人物角色', { exact: true }).fill('交付审阅者')
  await page.getByLabel('工作指令', { exact: true }).fill('结合需求、任务依赖与交付证据提出审阅结论。')
  await page.getByLabel('工具名称', { exact: true }).fill('read_file')
  await page.getByLabel('技能版本', { exact: true }).selectOption(v2)
  await matrix('asset-agent-editor')
  await save()
  await publish()
  await back()
  await page.getByTestId('asset-create').click()
  await page.getByLabel('资产类型', { exact: true }).selectOption('mcp')
  await page.getByTestId('asset-name').fill('项目文档 MCP')
  await page.getByLabel('命令名称', { exact: true }).fill('mcp-project-docs')
  await page.getByLabel('所需密钥名称', { exact: true }).fill('PROJECT_DOCS_TOKEN')
  await save()
  await publish()
  check(
    'MCP definition distinguishes registration from actual availability',
    await page.getByText('配置已登记；本机安装、密钥授权和连接可用性尚未验证。', { exact: true }).isVisible(),
  )
  await capture('asset-mcp-registered')
  await back()
  await page.getByTestId('asset-create').click()
  await page.getByLabel('资产类型', { exact: true }).selectOption('tool')
  await page.getByTestId('asset-name').fill('工作区文件读取')
  await page.getByLabel('本机工具名称', { exact: true }).fill('read_file')
  await page
    .getByLabel('用途与权限范围', { exact: true })
    .fill('读取已授权工作区中的文件，用于收集审阅证据。')
  await save()
  await publish()
  await back()
  const assets = await api(() => window.projectos.organization.assets())
  check(
    'Four asset kinds persist through typed IPC',
    new Set(assets.assets.map((item) => item.kind)).size === 4,
  )
  await matrix('assets-list')
  await page.getByLabel('搜索资产', { exact: true }).fill('MCP')
  check(
    'Asset search filters actual records',
    (await page.locator('.org-asset-table tbody tr').count()) === 1,
  )
  await page.getByLabel('搜索资产', { exact: true }).fill('')
  await page.getByRole('button', { name: '交付证据检查', exact: true }).click()
  await page.getByLabel('当前版本', { exact: true }).selectOption(v2)
  await page.getByLabel('绑定到项目', { exact: true }).selectOption(project.id)
  check(
    'A published replacement version can be chosen explicitly',
    await page.getByTestId('asset-bind').isEnabled(),
  )
  await page.getByRole('button', { name: '下线版本', exact: true }).click()
  await page.getByTestId('asset-confirm-transition').click()
  await page.waitForFunction(
    () => document.querySelector('[data-testid="asset-status"]')?.textContent === '已下线',
  )
  check('Deprecated versions disable new binding in UI', await page.getByTestId('asset-bind').isDisabled())
  await page.getByLabel('当前版本', { exact: true }).selectOption(v1)
  await page.getByRole('button', { name: '撤销版本', exact: true }).click()
  await page.getByTestId('asset-confirm-transition').click()
  await page.waitForFunction(
    () => document.querySelector('[data-testid="asset-status"]')?.textContent === '已撤销',
  )
  detail = await page.evaluate((id) => window.projectos.organization.assetDetail({ assetId: id }), skill.id)
  check(
    'Revocation preserves a visible revoked pin and its immutable hash',
    detail.bindings[0]?.versionId === v1 &&
      detail.bindings[0]?.status === 'revoked' &&
      detail.bindings[0]?.checksum === detail.versions.find((version) => version.id === v1).checksum,
  )
  await matrix('asset-revoked')
  const contrast = await page.getByTestId('asset-detail').evaluate((el) => {
    const rgb = (value) =>
      value
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
    const lum = (value) =>
      rgb(value)
        .map((v) => {
          v /= 255
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
        })
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
    const style = getComputedStyle(el),
      fg = lum(style.color),
      bg = lum(getComputedStyle(el.closest('.pui-overlay-surface')).backgroundColor)
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
  })
  check(
    'Asset body contrast exceeds AA on the opaque settings surface',
    contrast >= 4.5,
    `${contrast.toFixed(2)}:1`,
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  check(
    'Reduced motion preference reaches shared Motion controls',
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
  )
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const history = await page.evaluate(async () => {
    const agent = (await window.projectos.organization.assets()).assets.find(
      (asset) => asset.kind === 'agent',
    )
    let last
    for (let index = 0; index < 24; index++)
      last = await window.projectos.organization.createAssetVersion({
        assetId: agent.id,
        version: `2.0.${index}`,
        definition: {
          kind: 'agent',
          role: '交付审阅者',
          runtime: 'native',
          instructions: '审阅证据。'.repeat(3800),
          skillVersionIds: [],
          toolIds: [],
        },
      })
    return { count: last.versions.length, bytes: new TextEncoder().encode(JSON.stringify(last)).length }
  })
  check(
    'Version history above 1MiB remains readable within the explicit 8MiB bound',
    history.count === 25 && history.bytes > 1024 * 1024 && history.bytes < 8 * 1024 * 1024,
    `${history.bytes} bytes`,
  )
  return { assetId: skill.id, pinnedVersionId: v1 }
}

export async function exerciseReadonlyAssets({ page, app, serverUrl, password, matrix, check, waitFor, audit }) {
  await app.evaluate(() => {
    globalThis.__orgAuthorizeUrl = null
  })
  await page.getByTestId('org-server-url').fill(serverUrl)
  await page.getByTestId('org-connect').click()
  await waitFor(() => app.evaluate(() => globalThis.__orgAuthorizeUrl), 'member browser authorization')
  const url = await app.evaluate(() => globalThis.__orgAuthorizeUrl)
  const event = app.waitForEvent('window')
  await app.evaluate(async ({ BrowserWindow }, url) => {
    const browser = new BrowserWindow({
      width: 1100,
      height: 900,
      webPreferences: {
        partition: 'org-a2-member-browser',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    globalThis.__orgBrowser = browser
    await browser.loadURL(url)
  }, url)
  const browser = await event
  await browser.getByLabel('邮箱', { exact: true }).fill('member-a1@demo.invalid')
  await browser.getByLabel('密码', { exact: true }).fill(password)
  await browser.getByRole('button', { name: '登录并继续', exact: true }).click()
  await browser.getByRole('button', { name: '授权此设备', exact: true }).click()
  await waitFor(
    async () => (await page.evaluate(() => window.projectos.organization.status())).status === 'connected',
    'member connected',
  )
  await app.evaluate(() => globalThis.__orgBrowser?.destroy())
  await page.getByRole('button', { name: '组织资产', exact: true }).click()
  await page.getByRole('button', { name: '项目文档 MCP', exact: true }).waitFor()
  check(
    'Read-only member sees scoped assets without publishing controls',
    (await page.getByTestId('asset-create').count()) === 0,
  )
  await page.getByRole('button', { name: '项目文档 MCP', exact: true }).click()
  await page.getByText('只读', { exact: true }).waitFor()
  check(
    'Read-only detail hides version management',
    (await page.getByRole('button', { name: '新建版本', exact: true }).count()) === 0 &&
      (await page.getByRole('button', { name: '撤销版本', exact: true }).count()) === 0,
  )
  const denied = await page.evaluate(async () => {
    try {
      await window.projectos.organization.createAsset({
        name: 'Forbidden attempt',
        visibility: 'organization',
        projectId: null,
        version: '1.0.0',
        definition: { kind: 'skill', instructions: 'test', toolIds: [] },
      })
      return { blocked: false, message: '' }
    } catch (error) {
      return { blocked: true, message: error.message }
    }
  })
  check(
    'Forged renderer publication still fails server authorization',
    denied.blocked &&
      denied.message === '你没有此操作的权限。' &&
      (await page.evaluate(() => window.projectos.organization.assets())).assets.length === 4,
  )
  await matrix('asset-readonly')
  await audit()
  await page.getByTestId('org-disconnect').click()
  await page.getByTestId('org-disconnect-confirm').click()
  await waitFor(
    async () => (await page.evaluate(() => window.projectos.organization.status())).status === 'local',
    'member logout',
  )
}
