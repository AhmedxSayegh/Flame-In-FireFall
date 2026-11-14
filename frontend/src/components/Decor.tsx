import type { ReactNode } from 'react';

/** Four-point star. Decorative, aria-hidden. */
export function Star({ size = 12, className = '', color = '#132F45' }: { size?: number; className?: string; color?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" className={className}>
      <path d="M12 0 C13 9 15 11 24 12 C15 13 13 15 12 24 C11 15 9 13 0 12 C9 11 11 9 12 0Z" fill={color} />
    </svg>
  );
}

/** Thin elliptical orbit with a small planet. */
export function Orbit({ className = '', w = 420, h = 160, tilt = -12 }: { className?: string; w?: number; h?: number; tilt?: number }) {
  return (
    <svg aria-hidden viewBox={`0 0 ${w} ${h}`} className={`pointer-events-none ${className}`} fill="none">
      <g transform={`rotate(${tilt} ${w / 2} ${h / 2})`} stroke="#132F45" strokeWidth="0.75">
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 6} ry={h / 2 - 20} opacity="0.22" />
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 50} ry={h / 2 - 38} opacity="0.12" strokeDasharray="2 5" />
        <circle cx={w - 18} cy={h / 2 - 4} r="5" fill="#fff" opacity="0.6" />
      </g>
    </svg>
  );
}

/** Large orbital system for the page-one corner. */
export function OrbitalSystem({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 360 360" className={`pointer-events-none ${className}`} fill="none" stroke="#132F45">
      <circle cx="180" cy="180" r="22" strokeWidth="0.9" opacity="0.35" />
      <path d="M170 160 a22 22 0 1 0 22 36 a18 18 0 1 1 -22 -36z" fill="#132F45" opacity="0.06" stroke="none" />
      <ellipse cx="180" cy="180" rx="90" ry="34" strokeWidth="0.7" opacity="0.25" transform="rotate(-24 180 180)" />
      <ellipse cx="180" cy="180" rx="150" ry="62" strokeWidth="0.6" opacity="0.16" transform="rotate(-24 180 180)" />
      <ellipse cx="180" cy="180" rx="172" ry="118" strokeWidth="0.5" opacity="0.1" strokeDasharray="1 6" />
      <circle cx="262" cy="143" r="4.5" strokeWidth="0.9" opacity="0.5" fill="#fff" />
      <circle cx="58" cy="236" r="3" fill="#32667F" stroke="none" opacity="0.45" />
      <circle cx="318" cy="112" r="2" fill="#EA8B33" stroke="none" opacity="0.7" />
    </svg>
  );
}

/** Dots joined by fine lines. */
export function Constellation({ className = '' }: { className?: string }) {
  const pts: [number, number][] = [[10, 70], [48, 46], [86, 58], [118, 20], [150, 34], [132, 78]];
  return (
    <svg aria-hidden viewBox="0 0 160 90" className={`pointer-events-none ${className}`}>
      <polyline points={pts.slice(0, 5).map((p) => p.join(',')).join(' ')} fill="none" stroke="#132F45" strokeWidth="0.6" opacity="0.28" />
      <line x1="86" y1="58" x2="132" y2="78" stroke="#132F45" strokeWidth="0.6" opacity="0.28" />
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 3 ? 2.2 : 1.5} fill={i === 3 ? '#32667F' : '#132F45'} opacity="0.5" />)}
    </svg>
  );
}

/** Section title with index, star accent and optional orbital ring behind it. */
export function SectionTitle({ index, title, kicker, orbit = false, right }: { index?: string; title: string; kicker?: string; orbit?: boolean; right?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
      <div className="relative">
        {orbit && <Orbit className="absolute -left-10 -top-9 w-[320px] opacity-80" w={420} h={140} tilt={-6} />}
        <div className="relative flex items-center gap-3">
          {index && <span className="display text-sm font-light tracking-[0.3em] text-teal">{index}</span>}
          <Star size={10} color="#EA8B33" />
        </div>
        <h2 className="relative mt-1 text-[34px] font-medium uppercase leading-none sm:text-[40px]">{title}</h2>
        {kicker && <p className="relative mt-2 max-w-2xl text-sm text-muted">{kicker}</p>}
      </div>
      {right}
    </div>
  );
}

export function Divider() {
  return (
    <div aria-hidden className="my-16 flex items-center gap-4">
      <div className="h-px flex-1 bg-line" />
      <Star size={8} color="#32667F" />
      <span className="h-1.5 w-1.5 rounded-full border border-navy/40" />
      <Star size={8} color="#32667F" />
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}
