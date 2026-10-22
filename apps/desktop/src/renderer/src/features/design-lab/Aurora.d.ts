declare module './Aurora' {
  import type { CSSProperties, ComponentType } from 'react'
  const Aurora: ComponentType<{
    colorStops?: string[]
    amplitude?: number
    blend?: number
    speed?: number
    time?: number
    height?: number
    scale?: number
    glow?: number
    brightness?: number
    layers?: number
    direction?: 'top' | 'bottom'
    mouseInteraction?: boolean
    intro?: boolean
    opacity?: number
    lightMode?: boolean
    paused?: boolean
    dpr?: number
    className?: string
    style?: CSSProperties
  }>
  export default Aurora
}

export {}

