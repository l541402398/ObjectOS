/** Sample real Electron composited backgrounds. Diagnostic text hiding is restored before returning.
 * Normal native screenshots remain untouched; this is a complement to axe, not an AA certificate.
 */
export async function compositeContrast(page, win, selector) {
  const collect = () => page.evaluate((selector) => {
    const root = document.querySelector(selector), items = []
    if (!root) throw new Error(`Missing contrast scope: ${selector}`)
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walk.nextNode()) {
      const node = walk.currentNode, el = node.parentElement
      if (!node.textContent.trim() || !el || el.closest('svg,script,style,[disabled],[aria-disabled="true"],[aria-hidden="true"],.monaco-editor')) continue
      const style = getComputedStyle(el), range = document.createRange(); range.selectNode(node)
      if (style.visibility !== 'visible' || style.display === 'none') continue
      let opacity = 1
      for (let parent = el; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity)
      if (opacity <= 0.01) continue
      const rgba = style.color.match(/[\d.]+/g)?.map(Number)
      if (!rgba || rgba.length < 3) continue
      const points = [...range.getClientRects()].flatMap((r) => [0.2, 0.5, 0.8].map((t) => ({ x: r.left + r.width * t, y: r.top + r.height / 2 })))
        .filter((p) => p.x > 1 && p.y > 1 && p.x < innerWidth - 1 && p.y < innerHeight - 1 && el.contains(document.elementFromPoint(p.x, p.y)))
      if (!points.length) continue
      items.push({ text: node.textContent.trim().slice(0, 90), className: el.className, foreground: rgba, opacity, font: style.font, points })
    }
    return { items, width: innerWidth, height: innerHeight }
  }, selector)
  const style = await page.addStyleTag({ content: '* { -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }' })
  try {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.waitForTimeout(350)
    // A live Runtime query may finish while the native compositor catches up. Only sample a stable
    // layout; otherwise text coordinates from the old layout can land on a new button or icon.
    let items, png, stable = false
    for (let attempt = 0; attempt < 4; attempt++) {
      items = await collect()
      png = await win.evaluate(async (w) => (await w.webContents.capturePage()).toPNG().toString('base64'))
      if (JSON.stringify(items) === JSON.stringify(await collect())) { stable = true; break }
      await page.waitForTimeout(150)
    }
    if (!stable) throw new Error('Composited contrast capture did not reach a stable layout')
    return await page.evaluate(async ({ png, items }) => {
      const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0)
      const luminance = (rgb) => rgb.slice(0, 3).map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
      const measurements = items.items.map(({ points, ...item }) => {
        const samples = points.map((p) => {
          const background = [...ctx.getImageData(Math.floor(p.x * bitmap.width / items.width), Math.floor(p.y * bitmap.height / items.height), 1, 1).data]
          const alpha = (item.foreground[3] ?? 1) * item.opacity
          const ink = item.foreground.slice(0, 3).map((v, i) => alpha * v + (1 - alpha) * background[i])
          const a = luminance(ink), b = luminance(background)
          return { ...p, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
        })
        return { ...item, minimum: Math.min(...samples.map((s) => s.ratio)), samples }
      })
      bitmap.close()
      return { method: 'Native capturePage background sampling with text temporarily unpainted; all sampled text uses conservative 4.5:1 threshold. Disabled, SVG, editor tokens and obscured/offscreen text excluded.', count: measurements.length, minimum: Math.min(...measurements.map((m) => m.minimum)), failures: measurements.filter((m) => m.minimum < 4.5), measurements }
    }, { png, items })
  } finally { await style.evaluate((el) => el.remove()) }
}
