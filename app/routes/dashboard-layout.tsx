import { useState } from "react";
import { Form, Link, NavLink, Outlet, useLocation } from "react-router";

import type { Route } from "./+types/dashboard-layout";
import { Icon, type IconName } from "~/components/icon";
import { requireAuthenticatedUser } from "~/lib/auth.server";

type NavigationItem = {
	label: string;
	to: string;
	icon: IconName;
};

const primaryNavigation: NavigationItem[] = [
	{ label: "Overview", to: "/", icon: "dashboard" },
	{ label: "Legislation", to: "/legislation", icon: "gavel" },
	{ label: "Events", to: "/events", icon: "calendar" },
	{ label: "Projects", to: "/projects", icon: "clipboard" },
	{ label: "Updates", to: "/updates", icon: "message" },
];

const communityNavigation: NavigationItem[] = [
	{ label: "Organizations", to: "/organizations", icon: "building" },
	{ label: "Members", to: "/members", icon: "people" },
	{ label: "Notifications", to: "/notifications", icon: "bell" },
];

const adminNavigation: NavigationItem[] = [
	{ label: "Organization admin", to: "/admin/organizations", icon: "building" },
	{ label: "Member access", to: "/admin/members", icon: "people" },
	{ label: "Invitations", to: "/admin/invitations", icon: "user" },
];

function NavigationGroup({
	label,
	items,
	onNavigate,
}: {
	label: string;
	items: NavigationItem[];
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

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	return { user };
}

function getInitials(name: string | null, email: string) {
	const source = name?.trim() || email.split("@")[0] || "Member";
	return source
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("");
}

export default function DashboardLayout({ loaderData }: Route.ComponentProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const { user } = loaderData;
	const location = useLocation();
	const currentPage =
		[...primaryNavigation, ...communityNavigation, ...adminNavigation].find(
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
					{user.siteRole === "site_admin" && (
						<NavigationGroup
							items={adminNavigation}
							label="Administration"
							onNavigate={() => setMenuOpen(false)}
						/>
					)}
				</nav>

				<div className="sidebar-callout">
					<span className="callout-icon">
						<Icon name="sparkles" size={17} />
					</span>
					<div>
						<strong>Private workspace</strong>
						<p>Invitations active · Phase 2</p>
					</div>
				</div>

				<div className="sidebar-account">
					<NavLink className="profile-card" to="/profile" onClick={() => setMenuOpen(false)}>
						<span className="avatar">{getInitials(user.name, user.email)}</span>
						<span className="profile-copy">
							<strong>{user.name || user.email}</strong>
							<small>{user.siteRole === "site_admin" ? "Site administrator" : "Member"}</small>
						</span>
						<Icon name="chevron-right" size={16} />
					</NavLink>
					<Form action="/logout" method="post">
						<button className="sidebar-signout" type="submit">Sign out</button>
					</Form>
				</div>
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
