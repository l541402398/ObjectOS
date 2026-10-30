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
  canvas: '#E8E0D2',
  canvasElevated: '#F2EADF',
  surface: '#FBF6EC',
  surfaceRaised: '#FFFBF4',
  surfaceSunken: '#E2D7C6',
  surfaceHover: '#F3EADB',
  overlay: 'rgba(252,247,238,.82)',
  textPrimary: '#1D232B',
  textSecondary: '#494640',
  textTertiary: '#5E564A',
  textDisabled: '#A79C8C',
  textInverse: '#FFF8EF',
  accent: '#8E3C1B',
  accentStrong: '#743016',
  accentSoft: '#F4E3D8',
  accentBorder: 'rgba(180,85,45,.30)',
  accentContrast: '#FFF8EF',
  success: '#30543F',
  successSoft: '#E7F0E8',
  warning: '#7A4E12',
  warningSoft: '#F8ECD9',
  danger: '#A23A34',
  dangerSoft: '#F7E3DF',
  info: '#2D5F57',
  infoSoft: '#E4EFEC',
  border: 'rgba(49,41,31,.14)',
  borderStrong: 'rgba(49,41,31,.26)',
  divider: 'rgba(49,41,31,.09)',
  focusRing: 'rgba(180,85,45,.30)',
  selection: 'rgba(180,85,45,.16)',
  glassBg: 'rgba(252,247,238,.72)',
  glassBorder: 'rgba(255,251,244,.68)',
  glassHighlight: 'rgba(255,251,244,.90)',
  codeBg: '#F4EDE1',
  codeBorder: 'rgba(49,41,31,.10)',
  shadowColor: 'rgba(43,33,23,.12)',
  scrim: 'rgba(24,18,12,.34)',
  scrollbar: 'rgba(49,41,31,.18)',
  scrollbarHover: 'rgba(49,41,31,.30)',
}

export const darkPalette: ThemePalette = {
  canvas: '#0B1118',
  canvasElevated: '#101821',
  surface: '#131B24',
  surfaceRaised: '#19232E',
  surfaceSunken: '#0A1016',
  surfaceHover: '#1D2834',
  overlay: 'rgba(18,25,34,.86)',
  textPrimary: '#F0EBE1',
  textSecondary: '#C8C2B6',
  textTertiary: '#A49E92',
  textDisabled: '#5E5A52',
  textInverse: '#0B1118',
  accent: '#E08A5B',
  accentStrong: '#F2A474',
  accentSoft: 'rgba(224,138,91,.16)',
  accentBorder: 'rgba(224,138,91,.34)',
  accentContrast: '#0B1118',
  success: '#87B99A',
  successSoft: 'rgba(135,185,154,.14)',
  warning: '#D7A352',
  warningSoft: 'rgba(215,163,82,.14)',
  danger: '#E08078',
  dangerSoft: 'rgba(224,128,120,.13)',
  info: '#7FB7A8',
  infoSoft: 'rgba(127,183,168,.13)',
  border: 'rgba(225,233,240,.13)',
  borderStrong: 'rgba(225,233,240,.24)',
  divider: 'rgba(225,233,240,.08)',
  focusRing: 'rgba(224,138,91,.38)',
  selection: 'rgba(224,138,91,.22)',
  glassBg: 'rgba(18,25,34,.72)',
  glassBorder: 'rgba(225,233,240,.12)',
  glassHighlight: 'rgba(225,233,240,.06)',
  codeBg: '#0E151D',
  codeBorder: 'rgba(225,233,240,.08)',
  shadowColor: 'rgba(0,0,0,.42)',
  scrim: 'rgba(4,7,10,.58)',
  scrollbar: 'rgba(225,233,240,.16)',
  scrollbarHover: 'rgba(225,233,240,.28)',
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
