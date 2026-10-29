/**
 * ProjectOS 用户手册 — 声明式流程执行器（docsxai 思路的最小实现）。
 *
 * 一个流程文件（docs/user-guide/flows/*.json）由若干步骤组成。每一步声明：
 *   do        要执行的真实 UI 动作（点击/输入/等待/断言）
 *   shot      截图文件名
 *   focus     要框选并编号的元素选择器（标注脚本据此画箭头与放大图）
 *   text      中文正文（前置条件、操作、预期结果、常见问题）
 *
 * 执行器只负责“真的把界面点一遍并截图”，不生成任何假界面。
 * 重放：node docs/user-guide/tools/capture-docs.mjs --flow=01-first-launch
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 选择器语法：css=... / text=... / role=button[name=...] / label=... / placeholder=... */
export function locator(page, spec) {
  if (spec.startsWith('text=')) return page.getByText(spec.slice(5), { exact: false }).first()
  if (spec.startsWith('label=')) return page.getByLabel(spec.slice(6)).first()
  if (spec.startsWith('placeholder=')) return page.getByPlaceholder(spec.slice(12)).first()
  const role = /^role=([a-z]+)\[name=(.*)\]$/.exec(spec)
  if (role) {
    // Ant Design 会在两个汉字之间插入空格（“保 存”），所以按字符匹配并允许空白。
    const pattern = [...role[2]].map(escapeRegExp).join('\\s*')
    return page.getByRole(role[1], { name: new RegExp(pattern, 'i') }).first()
  }
  return page.locator(spec).first()
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function perform(page, action, ctx) {
  if (typeof action === 'string') {
    await locator(page, action).click()
    return
  }
  const [kind, value] = Object.entries(action)[0] ?? []
  switch (kind) {
    case 'click': {
      const target = locator(page, value)
      await target.waitFor({ state: 'visible', timeout: ctx.timeout })
      await target.click()
      break
    }
    case 'clickIfVisible': {
      const target = locator(page, value)
      if (await target.isVisible().catch(() => false)) await target.click()
      break
    }
    case 'fill': {
      const target = value.label
        ? locator(page, `label=${value.label}`)
        : value.placeholder
          ? locator(page, `placeholder=${value.placeholder}`)
          : locator(page, value.selector)
      await target.waitFor({ state: 'visible', timeout: ctx.timeout })
      await target.fill(String(value.value))
      break
    }
    case 'press':
      await page.keyboard.press(value)
      break
    case 'waitFor':
      await locator(page, value).waitFor({ state: 'visible', timeout: ctx.timeout })
      break
    case 'waitGone':
      await locator(page, value).waitFor({ state: 'detached', timeout: ctx.timeout })
      break
    case 'waitText':
      await page.waitForFunction(
        (text) => (document.body.innerText || '').includes(text),
        value,
        { timeout: ctx.timeout, polling: 500 },
      )
      break
    case 'waitFunction':
      await page.waitForFunction(value, null, { timeout: ctx.timeout, polling: 1000 })
      break
    case 'assertText': {
      const body = await page.evaluate(() => document.body.innerText)
      if (!body.includes(value)) throw new Error(`断言失败：页面中没有「${value}」`)
      break
    }
    case 'assertVisible': {
      const visible = await locator(page, value).isVisible().catch(() => false)
      if (!visible) throw new Error(`断言失败：元素不可见 ${value}`)
      break
    }
    case 'sleep':
      await sleep(value)
      break
    case 'eval':
      await page.evaluate(value)
      break
    case 'scrollTo':
      await locator(page, value).scrollIntoViewIfNeeded()
      break
    case 'hover':
      await locator(page, value).hover()
      break
    default:
      throw new Error(`未知动作：${kind}`)
  }
}

/** 采集焦点框：返回视口 CSS 像素坐标，供标注脚本换算。 */
async function collectRects(page, selectors) {
  if (!selectors?.length) return []
  const out = []
  for (const spec of selectors) {
    const target = locator(page, spec)
    if ((await target.count().catch(() => 0)) === 0) continue
    const box = await target.boundingBox().catch(() => null)
    if (!box || box.width < 4 || box.height < 4) continue
    const label = await target
      .evaluate((el) => (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40))
      .catch(() => '')
    out.push({
      selector: spec,
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.round(box.width),
      h: Math.round(box.height),
      label,
    })
  }
  return out
}

export async function runFlow(page, flow, { shotsDir, manifest, timeout = 45_000 }) {
  const shots = []
  for (const step of flow.steps) {
    const ctx = { timeout: step.timeout ?? timeout }
    if (step.skipIf) {
      const present = await locator(page, step.skipIf).isVisible().catch(() => false)
      if (present) {
        console.log(`  [skip] ${step.id} ${step.title}`)
        continue
      }
    }
    console.log(`  [step] ${step.id} ${step.title}`)
    for (const action of step.do ?? []) await perform(page, action, ctx)
    if (step.waitBeforeShot) await sleep(step.waitBeforeShot)
    if (step.shot) {
      mkdirSync(shotsDir, { recursive: true })
      const rects = await collectRects(page, step.focus)
      const viewport = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }))
      const file = join(shotsDir, `${step.shot}.png`)
      await page.screenshot({ path: file })
      shots.push({
        stepId: step.id,
        title: step.title,
        screenshot: `${step.shot}.png`,
        rects,
        viewport,
        capturedAt: new Date().toISOString(),
      })
      console.log(`         shot → ${step.shot}.png (${rects.length} focus)`)
    }
  }
  if (manifest) {
    manifest.flows.push({ id: flow.id, title: flow.title, shots })
    writeFileSync(manifest.path, JSON.stringify(manifest.data, null, 2), 'utf8')
  }
  return shots
}
