import type { Route } from "./+types/api-scraper-organizations";
import { requireScraperApiToken } from "~/lib/scraper-auth.server";
import { listScraperPartners } from "~/models/scraper.server";

export async function loader({ request, context }: Route.LoaderArgs) {
	await requireScraperApiToken(request, context.cloudflare.env);
	return Response.json({ partners: await listScraperPartners(context.cloudflare.env) });
}
