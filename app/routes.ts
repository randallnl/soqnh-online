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
	route("logout", "routes/logout.ts"),
	layout("routes/dashboard-layout.tsx", [
		index("routes/home.tsx"),
		route(":section", "routes/section.tsx"),
	]),
] satisfies RouteConfig;
