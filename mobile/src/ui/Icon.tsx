import Svg, { Circle, Path, Polygon, Rect } from 'react-native-svg';
import type { ColorValue } from 'react-native';

// Small stroke icon set (24x24, Feather-style) drawn with react-native-svg, so the app needs no icon font.
const PATHS = {
  holdings: ['M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z', 'M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16'],
  calendar: ['M16 2v4', 'M8 2v4', 'M3 10h18'],
  calendarCheck: ['M16 2v4', 'M8 2v4', 'M3 10h18', 'M9 16l2 2 4-4'],
  activity: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  bell: ['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 0 1-3.46 0'],
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'],
  plus: ['M12 5v14', 'M5 12h14'],
  chevronRight: ['M9 18l6-6-6-6'],
  chevronLeft: ['M15 18l-6-6 6-6'],
  chevronDown: ['M6 9l6 6 6-6'],
  refresh: ['M23 4v6h-6', 'M1 20v-6h6', 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10', 'M1 14l4.64 4.36A9 9 0 0 0 20.49 15'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
  lock: ['M7 11V7a5 5 0 0 1 10 0v4'],
  chart: ['M18 20V10', 'M12 20V4', 'M6 20v-6'],
  trendingUp: ['M23 6l-9.5 9.5-5-5L1 18', 'M17 6h6v6'],
  check: ['M20 6L9 17l-5-5'],
  close: ['M18 6L6 18', 'M6 6l12 12'],
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8'],
  phone: ['M12 18h.01'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  alert: ['M12 8v4', 'M12 16h.01'],
  info: ['M12 16v-4', 'M12 8h.01'],
  offline: ['M1 1l22 22', 'M16.72 11.06A10.94 10.94 0 0 1 19 12.55', 'M5 12.55a10.94 10.94 0 0 1 5.17-2.39', 'M10.71 5.05A16 16 0 0 1 22.58 9', 'M1.42 9a15.91 15.91 0 0 1 4.7-2.88', 'M8.53 16.11a6 6 0 0 1 6.95 0', 'M12 20h.01'],
  sparkle: [],
  // Navigation set.
  home: ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  pie: ['M21.21 15.89A10 10 0 1 1 8 2.83', 'M22 12A10 10 0 0 0 12 2v10z'],
  steps: ['M3 20h5v-5h5v-5h5V5h3'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  search: ['M21 21l-4.35-4.35'],
  filter: ['M4 6h16', 'M7 12h10', 'M10 18h4'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  external: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14L21 3'],
  arrowUp: ['M12 19V5', 'M5 12l7-7 7 7'],
  arrowDown: ['M12 5v14', 'M19 12l-7 7-7-7'],
  edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, color = '#fff', strokeWidth = 1.9 }: { name: IconName; size?: number; color?: ColorValue; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {name === 'calendar' || name === 'calendarCheck' ? <Rect x={3} y={4} width={18} height={18} rx={2} /> : null}
      {name === 'user' ? <Circle cx={12} cy={7} r={4} /> : null}
      {name === 'lock' ? <Rect x={3} y={11} width={18} height={11} rx={2} /> : null}
      {name === 'phone' ? <Rect x={5} y={2} width={14} height={20} rx={2} /> : null}
      {name === 'alert' || name === 'info' ? <Circle cx={12} cy={12} r={10} /> : null}
      {name === 'search' ? <Circle cx={11} cy={11} r={8} /> : null}
      {name === 'sparkle' ? <Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /> : null}
      {PATHS[name].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}
