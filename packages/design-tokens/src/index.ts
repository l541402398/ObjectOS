export type ThemeMode = 'light' | 'dark'

export interface ThemePalette {
  canvas: string
  canvasElevated: string
  surface: string
  surfaceRaised: string
  surfaceSunken: string
  surfaceHover: string
  overlay: string
  textPrimary: string
  textSecondary: string
  textTertiary: string
  textDisabled: string
  textInverse: string
  accent: string
  accentStrong: string
  accentSoft: string
  accentBorder: string
  accentContrast: string
  success: string
  successSoft: string
  warning: string
  warningSoft: string
  danger: string
  dangerSoft: string
  info: string
  infoSoft: string
  border: string
  borderStrong: string
  divider: string
  focusRing: string
  selection: string
  glassBg: string
  glassBorder: string
  glassHighlight: string
  codeBg: string
  codeBorder: string
  shadowColor: string
  scrim: string
  scrollbar: string
  scrollbarHover: string
}

export const lightPalette: ThemePalette = {
  canvas: '#F4F5F7',
  canvasElevated: '#FAFBFC',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: '#EFF1F5',
  surfaceHover: '#F7F8FA',
  overlay: 'rgba(255,255,255,.82)',
  textPrimary: '#17191E',
  textSecondary: '#4F5663',
  textTertiary: '#5C6370',
  textDisabled: '#B5BCC7',
  textInverse: '#FFFFFF',
  accent: '#0B5ED7',
  accentStrong: '#0848AB',
  accentSoft: '#EAF2FF',
  accentBorder: 'rgba(22,119,255,.28)',
  accentContrast: '#FFFFFF',
  success: '#11774B',
  successSoft: '#E7F7EF',
  warning: '#95560A',
  warningSoft: '#FFF4E2',
  danger: '#C0281F',
  dangerSoft: '#FEECEA',
  info: '#0A64A0',
  infoSoft: '#E7F5FC',
  border: 'rgba(18,28,45,.09)',
  borderStrong: 'rgba(18,28,45,.16)',
  divider: 'rgba(18,28,45,.07)',
  focusRing: 'rgba(22,119,255,.32)',
  selection: 'rgba(22,119,255,.16)',
  glassBg: 'rgba(255,255,255,.72)',
  glassBorder: 'rgba(255,255,255,.68)',
  glassHighlight: 'rgba(255,255,255,.9)',
  codeBg: '#F7F8FA',
  codeBorder: 'rgba(18,28,45,.08)',
  shadowColor: 'rgba(15,26,45,.10)',
  scrim: 'rgba(18,24,38,.34)',
  scrollbar: 'rgba(18,28,45,.18)',
  scrollbarHover: 'rgba(18,28,45,.30)',
}

export const darkPalette: ThemePalette = {
  canvas: '#0A0C11',
  canvasElevated: '#0E1117',
  surface: '#14171F',
  surfaceRaised: '#1A1E28',
  surfaceSunken: '#0E1117',
  surfaceHover: '#1D222D',
  overlay: 'rgba(20,23,31,.86)',
  textPrimary: '#F5F7FA',
  textSecondary: '#C5CBD5',
  textTertiary: '#AEB7C4',
  textDisabled: '#525B6B',
  textInverse: '#0A0C11',
  accent: '#6FAEFF',
  accentStrong: '#9AC8FF',
  accentSoft: 'rgba(76,141,255,.16)',
  accentBorder: 'rgba(111,174,255,.34)',
  accentContrast: '#07111F',
  success: '#4ED39A',
  successSoft: 'rgba(46,190,130,.14)',
  warning: '#F0B45C',
  warningSoft: 'rgba(240,180,92,.14)',
  danger: '#FF7B70',
  dangerSoft: 'rgba(255,123,112,.13)',
  info: '#6CC7F5',
  infoSoft: 'rgba(108,199,245,.13)',
  border: 'rgba(255,255,255,.10)',
  borderStrong: 'rgba(255,255,255,.19)',
  divider: 'rgba(255,255,255,.07)',
  focusRing: 'rgba(111,174,255,.38)',
  selection: 'rgba(111,174,255,.22)',
  glassBg: 'rgba(20,24,33,.72)',
  glassBorder: 'rgba(255,255,255,.12)',
  glassHighlight: 'rgba(255,255,255,.05)',
  codeBg: '#0E1117',
  codeBorder: 'rgba(255,255,255,.08)',
  shadowColor: 'rgba(0,0,0,.42)',
  scrim: 'rgba(2,4,8,.58)',
  scrollbar: 'rgba(255,255,255,.16)',
  scrollbarHover: 'rgba(255,255,255,.28)',
}

export function paletteFor(mode: ThemeMode): ThemePalette {
  return mode === 'dark' ? darkPalette : lightPalette
}

export const fonts = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  sizes: {
    /** Dense graph metadata only; never for key status. */
    micro: 12,
    caption: 13,
    small: 13,
    body: 14,
    bodyLarge: 15,
    title: 16,
    heading: 20,
    display: 28,
    hero: 34,
  },
  lineHeights: {
    tight: 1.28,
    snug: 1.42,
    normal: 1.55,
    relaxed: 1.68,
  },
  weights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  tracking: {
    tight: '-0.02em',
    snug: '-0.01em',
    normal: '0',
    wide: '0.04em',
  },
} as const

export const space = {
  0: 0,
  1: 2,
  2: 4,
  3: 6,
  4: 8,
  5: 12,
  6: 16,
  7: 20,
  8: 24,
  9: 32,
  10: 40,
  11: 48,
  12: 64,
} as const

export const radius = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  '2xl': 20,
  '3xl': 24,
  pill: 999,
} as const

export const motion = {
  fast: 120,
  base: 180,
  slow: 260,
  panel: 320,
  ease: 'cubic-bezier(.22,.61,.36,1)',
  easeOut: 'cubic-bezier(.16,1,.3,1)',
  spring: 'cubic-bezier(.34,1.56,.64,1)',
} as const

export const shadows = {
  none: 'none',
  xs: '0 1px 2px rgba(15,26,45,.05)',
  sm: '0 1px 3px rgba(15,26,45,.06), 0 6px 18px -10px rgba(15,26,45,.12)',
  md: '0 10px 30px -16px rgba(15,26,45,.20), 0 2px 6px rgba(15,26,45,.05)',
  lg: '0 24px 60px -28px rgba(15,26,45,.30), 0 6px 18px -10px rgba(15,26,45,.14)',
  glass: '0 8px 32px rgba(10,20,40,.08)',
  float: '0 18px 48px -22px rgba(10,20,40,.26)',
} as const

export const layout = {
  titlebar: 46,
  statusbar: 28,
  sidebar: 248,
  sidebarCollapsed: 76,
  inspector: 336,
  inspectorWide: 380,
  contentMax: 1560,
  pagePaddingX: 28,
  pagePaddingY: 24,
  breakpoints: { compact: 1024, wide: 1440, inspector: 1280 },
} as const

export const agentAccents = ['#4C8DFF', '#9A7CFF', '#22B8A0', '#E0A23C', '#E36A8C', '#5AB0E8'] as const

export const stageColors: Record<string, string> = {
  ideation: '#8A7CFF',
  requirements: '#4C8DFF',
  architecture: '#22A6C4',
  planning: '#22B8A0',
  implementation: '#E0A23C',
  testing: '#E36A8C',
  release: '#168F5B',
  maintenance: '#8792A5',
}

export const statusTone = {
  neutral: 'var(--color-text-secondary)',
  accent: 'var(--color-accent)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
} as const

export const tokens = { lightPalette, darkPalette, fonts, space, radius, motion, shadows, layout, agentAccents, stageColors } as const
