import type { SVGProps } from "react";

export type IconName =
  | "arrow-left"
  | "book"
  | "check"
  | "chevron-down"
  | "clipboard"
  | "close"
  | "collection"
  | "download"
  | "drag"
  | "edit"
  | "external"
  | "gamepad"
  | "image"
  | "info"
  | "link"
  | "menu"
  | "more"
  | "note"
  | "plus"
  | "search"
  | "sparkles"
  | "trash"
  | "upload"
  | "warning"
  | "youtube";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

const paths: Record<IconName, React.ReactNode> = {
  "arrow-left": <><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></>,
  book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  clipboard: <><rect width="14" height="16" x="5" y="4" rx="2" /><path d="M9 4V2h6v2" /><path d="M9 10h6M9 14h6" /></>,
  close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
  collection: <><rect x="3" y="3" width="18" height="6" rx="2" /><rect x="3" y="13" width="18" height="8" rx="2" /></>,
  download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  drag: <><circle cx="9" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="19" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="19" r="1" fill="currentColor" stroke="none" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
  external: <><path d="M15 3h6v6" /><path d="m10 14 11-11" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
  gamepad: <><path d="M6 10h4M8 8v4" /><path d="M15 11h.01M18 9h.01" /><path d="M6.5 5h11a4.5 4.5 0 0 1 4.2 6.1l-1.5 4A3 3 0 0 1 17.4 17H17l-2.5-2h-5L7 17h-.4a3 3 0 0 1-2.8-1.9l-1.5-4A4.5 4.5 0 0 1 6.5 5Z" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  note: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  sparkles: <><path d="m12 3-1 3-3 1 3 1 1 3 1-3 3-1-3-1Z" /><path d="m19 13-.7 2.3L16 16l2.3.7L19 19l.7-2.3L22 16l-2.3-.7Z" /><path d="m5 12-1 3-3 1 3 1 1 3 1-3 3-1-3-1Z" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v5M14 11v5" /></>,
  upload: <><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" /></>,
  warning: <><path d="M10.3 3.3 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  youtube: <><rect height="12" rx="4" width="19" x="2.5" y="6" /><path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none" /></>,
};

export function Icon({ name, size = 20, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
