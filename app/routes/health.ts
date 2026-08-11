import type { Route } from "./+types/health";

export async function loader({ context }: Route.LoaderArgs) {
	let database: "ready" | "unavailable" = "unavailable";

	try {
		const result = await context.cloudflare.env.DB.prepare(
			"SELECT 1 AS ready",
		).first<{ ready: number }>();
		database = result?.ready === 1 ? "ready" : "unavailable";
	} catch (error) {
		console.error(
			JSON.stringify({
				message: "health check database query failed",
				error: error instanceof Error ? error.message : "Unknown error",
			}),
		);
	}

	const status = database === "ready" ? "ok" : "degraded";

	return Response.json(
		{
			status,
			service: "soqnh-online",
			environment: context.cloudflare.env.APP_ENV,
			timestamp: new Date().toISOString(),
			bindings: {
				database,
				objectStorage: context.cloudflare.env.ASSETS
					? "configured"
					: "unavailable",
				email: context.cloudflare.env.EMAIL
					? "configured"
					: "unavailable",
				scraper: context.cloudflare.env.SCRAPER_RUN_URL
					? "configured"
					: "unavailable",
			},
		},
		{
			status: status === "ok" ? 200 : 503,
			headers: { "Cache-Control": "no-store" },
		},
	);
}
