import logoMark from '../assets/logo-mark.png'
import logoFull from '../assets/logo-full.png'

export function Logo({ size = 40, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <img src={logoMark} alt="" width={size} height={Math.round(size * 1.09)} className="select-none drop-shadow-sm" draggable={false} />
      {withText && (
        <span className="font-display text-[1.45rem] font-semibold leading-none tracking-tight text-ink">
          Invisio<span className="text-brand">MZ</span>
        </span>
      )}
    </span>
  )
}

export function LogoFull({ className = '' }: { className?: string }) {
  return <img src={logoFull} alt="Logótipo do InvisioMZ" className={className} draggable={false} />
}
