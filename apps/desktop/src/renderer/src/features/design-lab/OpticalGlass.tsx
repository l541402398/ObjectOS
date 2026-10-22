import { useId, type CSSProperties, type ReactNode } from 'react'

/**
 * Electron-safe optical glass fallback.
 *
 * liquid-glass-react's SVG displacement filter renders a dark rectangle over
 * Chromium's backdrop-filter output in this Electron build. This component
 * keeps a painted refraction layer (not just blur) and warps it with an SVG
 * displacement map. It is intentionally local to the Design Lab.
 */
export function OpticalGlass({
  children,
  className = '',
  radius = 18,
  style,
}: {
  children: ReactNode
  className?: string
  radius?: number
  style?: CSSProperties
}): React.ReactElement {
  const raw = useId()
  const id = `pdl-refract-${raw.replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <div className={`pdl-optical ${className}`} style={{ ...style, borderRadius: radius }}>
      <svg className="pdl-optical-filter" aria-hidden="true" width="0" height="0">
        <defs>
          <filter id={id} x="-12%" y="-20%" width="124%" height="140%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.014" numOctaves="1" seed="11" result="noise" />
            <feGaussianBlur in="noise" stdDeviation="1.4" result="softNoise" />
            <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="14" xChannelSelector="R" yChannelSelector="G" result="warped" />
            <feGaussianBlur in="warped" stdDeviation="0.35" />
          </filter>
        </defs>
      </svg>
      <span className="pdl-optical-warp" style={{ filter: `url(#${id})`, borderRadius: radius }} aria-hidden="true" />
      <span className="pdl-optical-sheen" style={{ borderRadius: radius }} aria-hidden="true" />
      <div className="pdl-optical-content">{children}</div>
    </div>
  )
}
