import { useId } from 'react';

/** Remindora mark: bell inside an orbit ring with a signal dot (from the app icon). */
export function RemindoraMark({ size = 32, className, withBackground = true }: { size?: number; className?: string; withBackground?: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}bg`} x1="100" y1="60" x2="920" y2="970" gradientUnits="userSpaceOnUse">
          <stop stopColor="#111C3E" />
          <stop offset="0.54" stopColor="#182B58" />
          <stop offset="1" stopColor="#090F27" />
        </linearGradient>
        <linearGradient id={`${id}bell`} x1="390" y1="280" x2="650" y2="724" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F5FCFF" />
          <stop offset=".33" stopColor="#A8F6FF" />
          <stop offset=".72" stopColor="#68BFFF" />
          <stop offset="1" stopColor="#7B71FF" />
        </linearGradient>
        <linearGradient id={`${id}ring`} x1="230" y1="290" x2="827" y2="694" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60E9FF" />
          <stop offset=".45" stopColor="#A58CFF" />
          <stop offset="1" stopColor="#FFBC5C" />
        </linearGradient>
        <linearGradient id={`${id}dot`} x1="765" y1="226" x2="818" y2="285" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFF0C8" />
          <stop offset="1" stopColor="#FF9E4B" />
        </linearGradient>
      </defs>
      {withBackground && <rect width="1024" height="1024" rx="232" fill={`url(#${id}bg)`} />}
      <ellipse cx="512" cy="490" rx="350" ry="210" transform="rotate(-24 512 490)" stroke={`url(#${id}ring)`} strokeWidth="34" strokeLinecap="round" />
      <path d="M509 277C425 277 358 345 358 428V514C358 548 344 580 320 608C305 626 318 654 342 654H682C706 654 719 626 704 608C680 580 666 548 666 514V428C666 345 599 277 515 277H509Z" fill={`url(#${id}bell)`} />
      <path d="M423 651C438 708 474 738 512 738C550 738 586 708 601 651H423Z" fill="#A8F4FF" />
      <path d="M478 253C478 234 493 218 512 218C531 218 546 234 546 253V283H478V253Z" fill="#9DEFFF" />
      <circle cx="786" cy="256" r="44" fill={`url(#${id}dot)`} />
    </svg>
  );
}
