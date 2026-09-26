/**
 * Icons.
 *
 * One original stroke set, drawn on the same 24×24 grid with the same 1.6px
 * stroke, currentColor for the stroke and no fills — so an icon looks right in
 * both themes and next to text of any size. They are geometric shapes, not
 * copies of anybody's artwork.
 *
 * An icon never carries meaning on its own: every place these are used also has
 * a word next to it. That rule exists because the product's own Day/Night
 * control once shipped as a bare moon, and "what does this button do?" was a
 * real question students asked.
 */

type IconProps = { className?: string; title?: string };

function Icon({ className = "", title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export function IconDashboard({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </Icon>
  );
}

export function IconLive({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <rect x="3" y="5" width="13" height="14" rx="2.5" />
      <path d="M16 10.5 21 8v8l-5-2.5z" />
    </Icon>
  );
}

export function IconAssignments({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M7 3.5h7l4.5 4.5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M9 13h6M9 16.5h4" />
    </Icon>
  );
}

export function IconListening({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M4.5 13a7.5 7.5 0 0 1 15 0" />
      <rect x="3" y="13" width="4" height="6" rx="2" />
      <rect x="17" y="13" width="4" height="6" rx="2" />
      <path d="M19 19v1.5" />
    </Icon>
  );
}

export function IconReading({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M12 6.5C10.5 5.2 8.4 4.5 5.5 4.5H4v14h1.5c2.9 0 5 .7 6.5 2 1.5-1.3 3.6-2 6.5-2H20v-14h-1.5c-2.9 0-5 .7-6.5 2z" />
      <path d="M12 6.5v14" />
    </Icon>
  );
}

export function IconWriting({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M4 19.5h16" />
      <path d="M6.5 16.5 16.8 6.2a2 2 0 0 1 2.8 2.8L9.3 19.3l-3.6.8z" />
      <path d="M14.8 8.2l1.9 1.9" />
    </Icon>
  );
}

export function IconSpeaking({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <rect x="9" y="3" width="6" height="10" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </Icon>
  );
}

export function IconGrammar({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M4 6.5h9M4 12h16M4 17.5h6" />
      <circle cx="17.5" cy="6.5" r="2.2" />
    </Icon>
  );
}

export function IconVocabulary({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M5 4.5h9.5a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z" />
      <path d="M16.5 6.5H19a1 1 0 0 1 1 1v10.5a1.5 1.5 0 0 1-1.5 1.5H16.5" />
      <path d="M8 9h6M8 12.5h4" />
    </Icon>
  );
}

export function IconVideo({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M10 9.5l5 2.5-5 2.5z" />
    </Icon>
  );
}

export function IconProgress({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M4 19.5V10M10 19.5V5M16 19.5v-6M22 19.5H2" />
    </Icon>
  );
}

export function IconMock({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

export function IconSupport({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M4 5.5h16v10H9l-5 4z" />
      <path d="M9 9.5h6M9 12.5h4" />
    </Icon>
  );
}

export function IconSettings({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.9 7.7l1.9 1.1M17.2 15.2l1.9 1.1M4.9 16.3l1.9-1.1M17.2 8.8l1.9-1.1" />
    </Icon>
  );
}

export function IconSearch({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Icon>
  );
}

export function IconSun({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </Icon>
  );
}

export function IconMoon({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </Icon>
  );
}

export function IconTarget({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" />
    </Icon>
  );
}

export function IconChevronRight({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </Icon>
  );
}

export function IconChevronLeft({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </Icon>
  );
}

export function IconArrowLeft({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M20 12H4" />
      <path d="m10 6-6 6 6 6" />
    </Icon>
  );
}

export function IconChevronDown({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />
    </Icon>
  );
}

/** Back navigation: the arrow that means "the page you came from". */
export function IconBack({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M20 12H4" />
      <path d="m10 6-6 6 6 6" />
    </Icon>
  );
}

export function IconClose({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function IconMenu({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

export function IconBell({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0v4l1.5 3h-14l1.5-3z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </Icon>
  );
}

export function IconUser({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </Icon>
  );
}

export function IconLogout({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M14 4.5H6.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H14" />
      <path d="M17 8.5 20.5 12 17 15.5" />
      <path d="M10.5 12h10" />
    </Icon>
  );
}

export function IconRetention({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M12 4.5c4.5 0 7.5 3 9 7.5-1.5 4.5-4.5 7.5-9 7.5S4.5 16.5 3 12c1.5-4.5 4.5-7.5 9-7.5z" />
      <circle cx="12" cy="12" r="2.5" />
    </Icon>
  );
}

export function IconAlert({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M12 4.5 21 19.5H3z" />
      <path d="M12 10v4M12 16.8v.4" />
    </Icon>
  );
}

export function IconPlay({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10 8.8 16 12l-6 3.2z" />
    </Icon>
  );
}

export function IconPeople({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19.5a5.4 5.4 0 0 0-1.6-3.8" />
    </Icon>
  );
}

export function IconAdmissions({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

export function IconContent({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <rect x="3.5" y="4.5" width="17" height="5" rx="1.5" />
      <rect x="3.5" y="14.5" width="7.5" height="5" rx="1.5" />
      <rect x="13.5" y="14.5" width="7" height="5" rx="1.5" />
    </Icon>
  );
}

export function IconAudit({ className, title }: IconProps) {
  return (
    <Icon className={className} title={title}>
      <path d="M6 3.5h9l4 4V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5z" />
      <path d="M15 3.5V8h4" />
      <path d="M8.5 13h7M8.5 16h4" />
    </Icon>
  );
}
