import {
	type RouteConfig,
	index,
	layout,
	route,
} from "@react-router/dev/routes";

export default [
	route("health", "routes/health.ts"),
	route("login", "routes/login.tsx"),
	layout("routes/dashboard-layout.tsx", [
		index("routes/home.tsx"),
		route(":section", "routes/section.tsx"),
	]),
] satisfies RouteConfig;
