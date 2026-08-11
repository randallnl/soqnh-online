import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const meta: Route.MetaFunction = () => [
	{ title: "State of Queer NH" },
	{
		name: "description",
		content:
			"A private collaboration hub for New Hampshire's queer community ecosystem.",
	},
];

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" data-theme="light">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let message = "Something went sideways";
	let details = "An unexpected error occurred.";
	let stack: string | undefined;

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? "Page not found" : "Request error";
		details =
			error.status === 404
				? "That page is not part of the ecosystem yet."
				: error.statusText || details;
	} else if (import.meta.env.DEV && error && error instanceof Error) {
		details = error.message;
		stack = error.stack;
	}

	return (
		<main className="error-page">
			<div className="error-card">
				<a className="brand-lockup brand-lockup--dark" href="/">
					<span className="brand-mark" aria-hidden="true">
						<span />
						<span />
					</span>
					<span>State of Queer NH</span>
				</a>
				<p className="eyebrow">{isRouteErrorResponse(error) ? error.status : "Error"}</p>
				<h1>{message}</h1>
				<p>{details}</p>
				<a className="button button--primary" href="/">
					Return to dashboard
				</a>
			</div>
			{stack && (
				<pre className="error-stack">
					<code>{stack}</code>
				</pre>
			)}
		</main>
	);
}
