/**
 * The icon set.
 *
 * Small, hand-drawn stroke icons on a 24×24 grid, inheriting `currentColor` and
 * the text size around them. There is deliberately no icon dependency: the
 * centre needs about twenty shapes, and a package would add weight and a second
 * visual language for no benefit.
 *
 * Rules these follow, from the interface contract:
 *   * an icon never replaces an important label — icon-only buttons carry an
 *     `aria-label`, and every navigation row shows its text;
 *   * `stroke-width` is 1.7 so a 20px icon stays legible without going bold;
 *   * `aria-hidden` by default, because the meaning is in the adjacent text.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      width="1em"
      height="1em"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
  </Svg>
);

export const IconLive = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M6.4 6.4a8 8 0 0 0 0 11.2M17.6 6.4a8 8 0 0 1 0 11.2" />
    <path d="M3.5 3.5a12 12 0 0 0 0 17M20.5 3.5a12 12 0 0 1 0 17" opacity="0.45" />
  </Svg>
);

export const IconTasks = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="m3 5.5 1.6 1.6L7.4 4.3" />
    <path d="m3 17.5 1.6 1.6 2.8-2.8" />
  </Svg>
);

export const IconListening = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
    <rect x="2.5" y="13.5" width="4" height="7" rx="1.6" />
    <rect x="17.5" y="13.5" width="4" height="7" rx="1.6" />
  </Svg>
);

export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="3" />
    <path d="M10.2 9.2v5.6l4.6-2.8z" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconReading = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 6.5C10.4 5.2 8.3 4.5 5.5 4.5H3v14h2.5c2.8 0 4.9.7 6.5 2 1.6-1.3 3.7-2 6.5-2H21v-14h-2.5c-2.8 0-4.9.7-6.5 2z" />
    <path d="M12 6.5v14" />
  </Svg>
);

export const IconWriting = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h16" />
    <path d="M6.5 16.5 16 7a2.5 2.5 0 0 1 3.5 3.5L10 20H6.5z" />
    <path d="M5.5 12.5 3 15l2 2 2.5-2.5" />
  </Svg>
);

export const IconSpeaking = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
    <path d="M12 18v3.5M8.5 21.5h7" />
  </Svg>
);

export const IconGrammar = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.5h9M8.5 6.5V18" />
    <path d="M14.5 18 19 8l4.5 10" opacity="0.9" />
    <path d="M16.2 14.5h5.6" />
  </Svg>
);

export const IconVocabulary = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H11v16H5.5A2.5 2.5 0 0 0 3 21.5z" />
    <path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H13v16h5.5A2.5 2.5 0 0 1 21 21.5z" />
  </Svg>
);

export const IconProgress = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <path d="M8 16.5v-4M12.5 16.5V8M17 16.5v-6.5" />
  </Svg>
);

export const IconMocks = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5.2l3.4 2" />
  </Svg>
);

export const IconSupport = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3a8.5 8.5 0 0 0-7.5 12.6L3 21l5.6-1.4A8.5 8.5 0 1 0 12 3z" />
    <path d="M9.5 9.6a2.6 2.6 0 0 1 5.1.8c0 1.7-2.6 2.1-2.6 3.6" />
    <path d="M12 17.2h.01" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8l1.3 2.4 2.7-.5 1 2.6 2.7.6-.6 2.7 1.9 2-1.9 2 .6 2.7-2.7.6-1 2.6-2.7-.5L12 21.2l-1.3-2.4-2.7.5-1-2.6-2.7-.6.6-2.7-1.9-2 1.9-2-.6-2.7 2.7-.6 1-2.6 2.7.5z" />
  </Svg>
);

export const IconPeople = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.4" />
    <path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" />
    <path d="M16.5 5.2a3.2 3.2 0 0 1 0 6.2M17.4 14.4A5.6 5.6 0 0 1 21.2 20" />
  </Svg>
);

export const IconAdmissions = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <path d="M3 9.5h18" />
    <path d="m8.5 14.5 1.6 1.6 3.2-3.2" />
  </Svg>
);

export const IconContent = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3.5" width="18" height="17" rx="2.5" />
    <path d="M7 8h10M7 12h10M7 16h6" />
  </Svg>
);

export const IconAudit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h9l4.5 4.5V21H6z" />
    <path d="M14.5 3v5h5" />
    <path d="M9.5 13h6M9.5 16.5h4" />
  </Svg>
);

export const IconRetention = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.5c0-1.4 3.6-2.5 8-2.5s8 1.1 8 2.5S16.4 9 12 9 4 7.9 4 6.5z" />
    <path d="M4 6.5v11C4 18.9 7.6 20 12 20s8-1.1 8-2.5v-11" />
    <path d="M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m15.6 15.6 4.4 4.4" />
  </Svg>
);

export const IconBack = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5" />
    <path d="m11 6-6 6 6 6" />
  </Svg>
);

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
  </Svg>
);

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 7h17M3.5 12h17M3.5 17h17" />
  </Svg>
);

export const IconTarget = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.6" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5.5 9 6.5 6.5L18.5 9" />
  </Svg>
);

export const IconUpload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
  </Svg>
);

export const IconFile = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
  </Svg>
);

export const IconLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 14.5 14.5 9.5" />
    <path d="M11 6.8l1.6-1.6a3.8 3.8 0 0 1 5.4 5.4L16.4 12" />
    <path d="M13 17.2l-1.6 1.6a3.8 3.8 0 0 1-5.4-5.4L7.6 12" />
  </Svg>
);

export const IconImage = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <circle cx="8.6" cy="9.8" r="1.6" />
    <path d="m4 17 4.8-4.8 3.4 3.4 2.6-2.4L20 17" />
  </Svg>
);

export const IconAudio = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10v4M8 7v10M12 4.5v15M16 7v10M20 10v4" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
  </Svg>
);

export const IconBook = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
    <path d="M8 3.5v17M11.5 8.5h6M11.5 12h6" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4 2.8 20h18.4z" />
    <path d="M12 10v4.5M12 17.4h.01" />
  </Svg>
);
