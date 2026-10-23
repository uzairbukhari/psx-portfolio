import { useId } from 'react';

/** Sipwise mark: rising monthly steps ending in a green gain dot. */
export function LogoMark({ size = 24, animate = false, markId }: { size?: number; animate?: boolean; markId?: string }) {
  const id = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      className={animate ? 'logo-mark m-draw' : 'logo-mark'}
      id={markId}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7db0ff" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <path
        className="logo-step"
        d="M6.5 23.5h5v-5h5v-5h5v-5h4"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle className="logo-dot" cx="25.5" cy="8.5" r="2.4" fill="#22e0a0" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <b className="logo-word">
      Sip<em>wise</em>
    </b>
  );
}
