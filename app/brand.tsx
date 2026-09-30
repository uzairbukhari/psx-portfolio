/** FolioRaah folded-F mark, reconstructed as flat two-tone vector (see public/brand/folioraah-mark.svg). */
export function BrandMark({
  size = 32,
  title,
  className,
}: {
  size?: number;
  /** Provide only when the mark stands alone; beside visible text it is decorative. */
  title?: string;
  className?: string;
}) {
  return (
    <svg
      width={(size * 347) / 436}
      height={size}
      viewBox="0 0 347 436"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path fill="var(--brand-sky)" d="M20 78 L130 15 Q138 2 160 2 L345 2 L345 68 Q345 127 282 127 L112 128 Z" />
      <path fill="var(--brand-cobalt)" d="M20 78 L268 218 Q280 223 280 240 L280 301 L205 301 L2 187 L2 103 Q2 85 20 78 Z" />
      <path fill="var(--brand-cobalt)" d="M2 257 L68 228 L122 255 L122 355 Q122 388 90 403 L20 433 Q2 435 2 415 Z" />
    </svg>
  );
}

export const TAGLINE = 'A clear path for every investment.';
export const DESCRIPTOR = 'PSX Portfolio & SIP Tracker';

/** Mark + real-text wordmark. `size` picks the header/sign-in scale; the tagline is a separate element. */
export function Brand({
  size = 'header',
  className,
}: {
  size?: 'header' | 'signin';
  className?: string;
}) {
  return (
    <span className={`brand-lockup brand-${size}${className ? ` ${className}` : ''}`}>
      <BrandMark size={size === 'signin' ? 64 : 32} className="brand-mark" />
      <span className="brand-word">FolioRaah</span>
    </span>
  );
}

export function Tagline({ className }: { className?: string }) {
  return <p className={`tagline${className ? ` ${className}` : ''}`}>{TAGLINE}</p>;
}
