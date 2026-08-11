export type IconName =
	| "activity"
	| "bell"
	| "building"
	| "calendar"
	| "chevron-right"
	| "clipboard"
	| "dashboard"
	| "gavel"
	| "heart"
	| "menu"
	| "message"
	| "people"
	| "plus"
	| "search"
	| "settings"
	| "sparkles"
	| "user"
	| "x";

const paths: Record<IconName, React.ReactNode> = {
	activity: <path d="M3 12h4l2.2-6 4.3 12 2.2-6H21" />,
	bell: (
		<>
			<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
			<path d="M10 21h4" />
		</>
	),
	building: (
		<>
			<path d="M4 21V4h10v17M14 9h6v12M8 8h2M8 12h2M8 16h2M17 13h1M17 17h1" />
			<path d="M2 21h20" />
		</>
	),
	calendar: (
		<>
			<rect x="3" y="5" width="18" height="16" rx="2" />
			<path d="M16 3v4M8 3v4M3 10h18" />
		</>
	),
	"chevron-right": <path d="m9 18 6-6-6-6" />,
	clipboard: (
		<>
			<rect x="5" y="4" width="14" height="17" rx="2" />
			<path d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h3" />
		</>
	),
	dashboard: (
		<>
			<rect x="3" y="3" width="7" height="7" rx="1" />
			<rect x="14" y="3" width="7" height="7" rx="1" />
			<rect x="3" y="14" width="7" height="7" rx="1" />
			<rect x="14" y="14" width="7" height="7" rx="1" />
		</>
	),
	gavel: (
		<>
			<path d="m14 6 4 4M9 11l4 4M5 19l10-10M4 20h8" />
			<rect x="12" y="3" width="7" height="4" rx="1" transform="rotate(45 15.5 5)" />
			<rect x="6" y="9" width="7" height="4" rx="1" transform="rotate(45 9.5 11)" />
		</>
	),
	heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
	menu: <path d="M4 7h16M4 12h16M4 17h16" />,
	message: (
		<>
			<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
			<path d="M8 9h8M8 13h5" />
		</>
	),
	people: (
		<>
			<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
			<circle cx="9" cy="7" r="4" />
			<path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
		</>
	),
	plus: <path d="M12 5v14M5 12h14" />,
	search: (
		<>
			<circle cx="11" cy="11" r="7" />
			<path d="m20 20-4-4" />
		</>
	),
	settings: (
		<>
			<circle cx="12" cy="12" r="3" />
			<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
		</>
	),
	sparkles: <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14ZM19 13l.7 2.3L22 16l-2.3.7L19 19l-.7-2.3L16 16l2.3-.7L19 13Z" />,
	user: (
		<>
			<circle cx="12" cy="8" r="4" />
			<path d="M4 21a8 8 0 0 1 16 0" />
		</>
	),
	x: <path d="m6 6 12 12M18 6 6 18" />,
};

export function Icon({
	name,
	size = 20,
	className,
}: {
	name: IconName;
	size?: number;
	className?: string;
}) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			height={size}
			viewBox="0 0 24 24"
			width={size}
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.8"
		>
			{paths[name]}
		</svg>
	);
}
