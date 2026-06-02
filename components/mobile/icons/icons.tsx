/**
 * Mobile-shell icons — KeyStone-style line icons.
 *
 * All icons are 24×24 viewBox, currentColor stroke, 2px stroke-width, round
 * caps + joins. Match the iconography in the brainstorm mockup. Adding a
 * new icon: add to IconKey and the IconRegistry below.
 */
import type { JSX, SVGProps } from "react";

export type IconKey =
  | "map"
  | "pin"
  | "survey"
  | "chat"
  | "more"
  | "report"
  | "plus"
  | "locate"
  | "compass"
  | "menu"
  | "bell"
  | "settings"
  | "members"
  | "import"
  | "analysis"
  | "reports"
  | "install"
  | "switch-project"
  | "sign-out"
  | "x";

type Props = SVGProps<SVGSVGElement>;

const base = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const ICON_PATHS: Record<IconKey, JSX.Element> = {
  map: (
    <>
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6" />
      <line x1="9" y1="3" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="21" />
    </>
  ),
  pin: (
    <>
      <path d="M12 22s8-7 8-13a8 8 0 1 0-16 0c0 6 8 13 8 13z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
  survey: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </>
  ),
  chat: <path d="M21 12a8 8 0 0 1-8 8H6l-3 3v-9a8 8 0 0 1 18-2z" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </>
  ),
  report: <path d="M3 11l18-8-7 18-2-8-9-2z" />,
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  locate: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="9" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </>
  ),
  menu: (
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>
  ),
  bell: <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  members: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  import: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </>
  ),
  analysis: (
    <>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </>
  ),
  reports: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </>
  ),
  install: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  "switch-project": (
    <>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  "sign-out": (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
  x: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
};

export function Icon({ name, ...rest }: { name: IconKey } & Props): JSX.Element {
  return (
    <svg {...base} {...rest}>
      {ICON_PATHS[name]}
    </svg>
  );
}

/**
 * KeyStone-style "＋" rendered as two solid bars instead of a stroked SVG.
 * Matches the field-PWA's add button exactly so the FAB feels native.
 */
export function PlusGlyph({ size = 22, color = "currentColor" }: { size?: number; color?: string }): JSX.Element {
  const barT = Math.round(size * 0.13);
  return (
    <span
      aria-hidden
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: barT,
          transform: "translateX(-50%)",
          background: color,
          borderRadius: 2,
        }}
      />
      <span
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          right: 0,
          height: barT,
          transform: "translateY(-50%)",
          background: color,
          borderRadius: 2,
        }}
      />
    </span>
  );
}
