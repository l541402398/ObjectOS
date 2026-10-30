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
  canvas: '#EFF4FC',
  canvasElevated: '#EFF4FC',
  surface: '#FBFDFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: '#EFF4FC',
  surfaceHover: '#F0F4FC',
  overlay: 'rgba(245,250,255,.82)',
  textPrimary: '#22304D',
  textSecondary: '#52617B',
  textTertiary: '#52617B',
  textDisabled: '#8996AD',
  textInverse: '#FFFFFF',
  accent: '#4F64D9',
  accentStrong: '#3E50BD',
  accentSoft: '#E9EDFF',
  accentBorder: 'rgba(79,100,217,.30)',
  accentContrast: '#FFFFFF',
  success: '#1D6B56',
  successSoft: '#E4F2EC',
  warning: '#805D18',
  warningSoft: '#F8F0DD',
  danger: '#A74758',
  dangerSoft: '#FAE9ED',
  info: '#246C7A',
  infoSoft: '#E2F2F6',
  border: 'rgba(66,88,132,.14)',
  borderStrong: 'rgba(66,88,132,.26)',
  divider: 'rgba(66,88,132,.09)',
  focusRing: 'rgba(79,100,217,.30)',
  selection: 'rgba(79,100,217,.16)',
  glassBg: 'rgba(245,250,255,.72)',
  glassBorder: 'rgba(255,255,255,.68)',
  glassHighlight: 'rgba(255,255,255,.90)',
  codeBg: '#EEF2FA',
  codeBorder: 'rgba(66,88,132,.10)',
  shadowColor: 'rgba(36,54,90,.12)',
  scrim: 'rgba(12,24,48,.34)',
  scrollbar: 'rgba(66,88,132,.18)',
  scrollbarHover: 'rgba(66,88,132,.30)',
}

export const darkPalette: ThemePalette = {
  canvas: '#0B1223',
  canvasElevated: '#101A30',
  surface: '#111B30',
  surfaceRaised: '#17243C',
  surfaceSunken: '#0B1427',
  surfaceHover: '#1D2C47',
  overlay: 'rgba(17,27,48,.86)',
  textPrimary: '#EFF4FF',
  textSecondary: '#B5C2D9',
  textTertiary: '#A4B4D0',
  textDisabled: '#6D7E9D',
  textInverse: '#0B1223',
  accent: '#9BADFF',
  accentStrong: '#B2C1FF',
  accentSoft: 'rgba(155,173,255,.16)',
  accentBorder: 'rgba(155,173,255,.34)',
  accentContrast: '#0B1223',
  success: '#7AD4B7',
  successSoft: 'rgba(122,212,183,.14)',
  warning: '#D8AE73',
  warningSoft: 'rgba(216,174,115,.14)',
  danger: '#E5919C',
  dangerSoft: 'rgba(229,145,156,.13)',
  info: '#6DD4E2',
  infoSoft: 'rgba(109,212,226,.13)',
  border: 'rgba(217,230,255,.13)',
  borderStrong: 'rgba(217,230,255,.24)',
  divider: 'rgba(217,230,255,.08)',
  focusRing: 'rgba(155,173,255,.38)',
  selection: 'rgba(155,173,255,.22)',
  glassBg: 'rgba(17,27,48,.72)',
  glassBorder: 'rgba(217,230,255,.12)',
  glassHighlight: 'rgba(217,230,255,.06)',
  codeBg: '#0C1629',
  codeBorder: 'rgba(217,230,255,.08)',
  shadowColor: 'rgba(0,0,0,.42)',
  scrim: 'rgba(3,7,17,.58)',
  scrollbar: 'rgba(217,230,255,.16)',
  scrollbarHover: 'rgba(217,230,255,.28)',
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
