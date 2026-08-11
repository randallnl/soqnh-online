import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";

import { Icon, type IconName } from "~/components/icon";

const primaryNavigation: Array<{
	label: string;
	to: string;
	icon: IconName;
}> = [
	{ label: "Overview", to: "/", icon: "dashboard" },
	{ label: "Legislation", to: "/legislation", icon: "gavel" },
	{ label: "Events", to: "/events", icon: "calendar" },
	{ label: "Projects", to: "/projects", icon: "clipboard" },
	{ label: "Updates", to: "/updates", icon: "message" },
];

const communityNavigation: Array<{
	label: string;
	to: string;
	icon: IconName;
}> = [
	{ label: "Organizations", to: "/organizations", icon: "building" },
	{ label: "Members", to: "/members", icon: "people" },
	{ label: "Notifications", to: "/notifications", icon: "bell" },
];

function NavigationGroup({
	label,
	items,
	onNavigate,
}: {
	label: string;
	items: typeof primaryNavigation;
	onNavigate: () => void;
}) {
	return (
		<div className="nav-group">
			<p className="nav-label">{label}</p>
			{items.map((item) => (
				<NavLink
					className={({ isActive }) =>
						`nav-item${isActive ? " nav-item--active" : ""}`
					}
					end={item.to === "/"}
					key={item.to}
					onClick={onNavigate}
					to={item.to}
				>
					<Icon name={item.icon} size={18} />
					<span>{item.label}</span>
					{item.label === "Notifications" && (
						<span className="nav-badge">3</span>
					)}
				</NavLink>
			))}
		</div>
	);
}

export default function DashboardLayout() {
	const [menuOpen, setMenuOpen] = useState(false);
	const location = useLocation();
	const currentPage =
		[...primaryNavigation, ...communityNavigation].find(
			(item) => item.to === location.pathname,
		)?.label ?? "Overview";

	return (
		<div className="app-frame">
			<a className="skip-link" href="#main-content">
				Skip to content
			</a>
			{menuOpen && (
				<button
					aria-label="Close navigation"
					className="sidebar-scrim"
					onClick={() => setMenuOpen(false)}
					type="button"
				/>
			)}
			<aside className={`sidebar${menuOpen ? " sidebar--open" : ""}`}>
				<div className="sidebar-header">
					<Link className="brand-lockup" to="/" onClick={() => setMenuOpen(false)}>
						<span className="brand-mark" aria-hidden="true">
							<span />
							<span />
						</span>
						<span>
							<strong>State of Queer</strong>
							<small>New Hampshire</small>
						</span>
					</Link>
					<button
						aria-label="Close navigation"
						className="icon-button sidebar-close"
						onClick={() => setMenuOpen(false)}
						type="button"
					>
						<Icon name="x" />
					</button>
				</div>

				<nav aria-label="Main navigation" className="sidebar-navigation">
					<NavigationGroup
						items={primaryNavigation}
						label="Workspace"
						onNavigate={() => setMenuOpen(false)}
					/>
					<NavigationGroup
						items={communityNavigation}
						label="Community"
						onNavigate={() => setMenuOpen(false)}
					/>
				</nav>

				<div className="sidebar-callout">
					<span className="callout-icon">
						<Icon name="sparkles" size={17} />
					</span>
					<div>
						<strong>Preview workspace</strong>
						<p>Foundation build · Phase 1</p>
					</div>
				</div>

				<NavLink className="profile-card" to="/profile" onClick={() => setMenuOpen(false)}>
					<span className="avatar">RN</span>
					<span className="profile-copy">
						<strong>Randall Nielsen</strong>
						<small>Site administrator</small>
					</span>
					<Icon name="chevron-right" size={16} />
				</NavLink>
			</aside>

			<div className="app-content">
				<header className="topbar">
					<div className="topbar-start">
						<button
							aria-label="Open navigation"
							className="icon-button menu-button"
							onClick={() => setMenuOpen(true)}
							type="button"
						>
							<Icon name="menu" />
						</button>
						<p className="mobile-page-title">{currentPage}</p>
					</div>
					<label className="search-box">
						<span className="sr-only">Search the ecosystem</span>
						<Icon name="search" size={18} />
						<input placeholder="Search people, organizations, posts…" type="search" />
						<kbd>⌘ K</kbd>
					</label>
					<div className="topbar-actions">
						<button aria-label="Notifications" className="icon-button notification-button" type="button">
							<Icon name="bell" />
							<span />
						</button>
						<Link className="button button--primary button--compact" to="/updates?compose=true">
							<Icon name="plus" size={17} />
							<span>New post</span>
						</Link>
					</div>
				</header>

				<main id="main-content" className="main-content">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
