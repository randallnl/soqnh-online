import type { Route } from "./+types/api-scraper-events";
import { readBoundedJson, requireScraperApiToken } from "~/lib/scraper-auth.server";
import { importScraperRecords, scraperPayloadSchema } from "~/models/scraper.server";

export async function loader() {
	return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}

export async function action({ request, context }: Route.ActionArgs) {
	await requireScraperApiToken(request, context.cloudflare.env);
	const payload = scraperPayloadSchema.safeParse(await readBoundedJson(request, 1_048_576));
	if (!payload.success) {
		return Response.json({ error: payload.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
	}
	const headerRunId = request.headers.get("X-Scraper-Run-Id");
	const candidateRunId = headerRunId && /^[0-9a-f-]{36}$/i.test(headerRunId) ? headerRunId : null;
	const runId = candidateRunId && await context.cloudflare.env.DB.prepare(
		"SELECT id FROM scraper_runs WHERE id = ?1 LIMIT 1",
	).bind(candidateRunId).first<string>("id") ? candidateRunId : null;
	return Response.json(await importScraperRecords(context.cloudflare.env, payload.data.records, runId));
}
