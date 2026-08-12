import {
	type RouteConfig,
	index,
	layout,
	route,
} from "@react-router/dev/routes";

export default [
	route("health", "routes/health.ts"),
	route("login", "routes/login.tsx"),
	route("auth/verify", "routes/auth-verify.ts"),
	route("invite/accept", "routes/invite-accept.tsx"),
	route("logout", "routes/logout.ts"),
	layout("routes/dashboard-layout.tsx", [
		index("routes/home.tsx"),
		route("notifications", "routes/notifications.tsx"),
		route("posts/new", "routes/post-new.tsx"),
		route("posts/:postId/edit", "routes/post-edit.tsx"),
		route("posts/:postId", "routes/post-detail.tsx"),
		route("organizations", "routes/organizations.tsx"),
		route("organizations/:slug/manage", "routes/organization-manage.tsx"),
		route("organizations/:slug", "routes/organization-detail.tsx"),
		route("admin/affiliations", "routes/admin-affiliations.tsx"),
		route("admin/organizations", "routes/admin-organizations.tsx"),
		route("admin/invitations", "routes/admin-invitations.tsx"),
		route("admin/members", "routes/admin-members.tsx"),
		route(":section", "routes/section.tsx"),
	]),
] satisfies RouteConfig;
