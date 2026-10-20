import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { darkPalette, fonts, lightPalette, type ThemePalette } from '@projectos/design-tokens'

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const SURFACES: Array<keyof ThemePalette> = ['canvas', 'canvasElevated', 'surface', 'surfaceRaised', 'surfaceSunken', 'surfaceHover']
const TEXT: Array<keyof ThemePalette> = ['textPrimary', 'textSecondary', 'textTertiary']
const STATUS: Array<keyof ThemePalette> = ['success', 'warning', 'danger', 'info', 'accent']

const css = readFileSync(join(import.meta.dirname, '..', 'packages', 'design-tokens', 'src', 'tokens.css'), 'utf8')

function cssVar(block: string, token: string): string | undefined {
  const name = `--color-${token.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`
  return new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)?.[1]?.toUpperCase()
}

describe.each([
  ['light', lightPalette, css.slice(0, css.indexOf("[data-theme='dark']"))],
  ['dark', darkPalette, css.slice(css.indexOf("[data-theme='dark']"))],
] as const)('%s theme', (_mode, palette, block) => {
  it.each(TEXT)('%s reaches WCAG AA 4.5:1 on every surface', (token) => {
    for (const surface of SURFACES) {
      expect(contrast(palette[token], palette[surface]), `${token} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(STATUS)('status text %s reaches 4.5:1 on base surfaces', (token) => {
    for (const surface of ['canvas', 'surface', 'surfaceSunken'] as const) {
      expect(contrast(palette[token], palette[surface]), `${token} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps tokens.css in sync with the TypeScript palette', () => {
    for (const token of [...SURFACES, ...TEXT, ...STATUS]) {
      expect(cssVar(block, token), token).toBe(palette[token].toUpperCase())
    }
  })
})

describe('type scale', () => {
  it('meets the minimum sizes for body and secondary text', () => {
    expect(fonts.sizes.body).toBeGreaterThanOrEqual(14)
    expect(fonts.sizes.small).toBeGreaterThanOrEqual(13)
    expect(fonts.sizes.caption).toBeGreaterThanOrEqual(13)
    expect(fonts.sizes.micro).toBeGreaterThanOrEqual(12)
  })

  it('has no hardcoded font sizes below 12px in stylesheets', () => {
    const files = [
      'apps/desktop/src/renderer/src/styles/app.css',
      'apps/desktop/src/renderer/src/features/orchestration/pages/orchestration.css',
      'apps/desktop/src/renderer/src/features/settings/settings.css',
      'packages/ui/src/styles.css',
      'packages/ai-ui/src/styles.css',
    ]
    for (const file of files) {
      const source = readFileSync(join(import.meta.dirname, '..', file), 'utf8')
      const tooSmall = [...source.matchAll(/font-size:\s*([0-9.]+)px/g)].filter((match) => Number(match[1]) < 12)
      expect(tooSmall.map((match) => match[0]), file).toEqual([])
    }
  })
})
