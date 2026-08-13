import { Form, Link, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/admin-scraper";
import { Icon } from "~/components/icon";
import { requireSiteAdmin } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import { formatEventDateTime } from "~/lib/events";
import { scraperParsers } from "~/lib/scraper";
import {
	createManualScraperRun,
	failManualScraperRun,
	finishManualScraperRun,
	getScraperAdministrationData,
	updateOrganizationScraperSettings,
} from "~/models/scraper.server";

const settingsSchema = z.object({
	intent: z.literal("save-settings"),
	organizationId: z.string().trim().min(1).max(100),
	eventSourceUrl: z.preprocess(
		(value) => typeof value === "string" && value.trim() ? value.trim() : null,
		z.url("Enter a complete source URL").max(2048).nullable(),
	),
	eventParser: z.preprocess(
		(value) => typeof value === "string" && value ? value : null,
		z.enum(scraperParsers).nullable(),
	),
	eventScrapingEnabled: z.preprocess((value) => value === "on", z.boolean()),
});

async function readSmallResponse(response: Response) {
	const limit = 65_536;
	const contentLength = Number(response.headers.get("Content-Length") ?? "0");
	if (contentLength > limit) throw new Error("Scraper response was unexpectedly large.");
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		length += value.byteLength;
		if (length > limit) {
			await reader.cancel();
			throw new Error("Scraper response was unexpectedly large.");
		}
		chunks.push(value);
	}
	const body = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}

function formatDateTime(value: string) {
	return new Intl.DateTimeFormat("en-US", {
		month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
		timeZone: "America/New_York",
	}).format(new Date(value));
}

export function meta() {
	return [{ title: "Event scraper · State of Queer NH" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	await requireSiteAdmin(request, context.cloudflare.env);
	return getScraperAdministrationData(context.cloudflare.env);
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const admin = await requireSiteAdmin(request, context.cloudflare.env);
	const formData = await request.formData();
	if (formData.get("intent") === "run") {
		const runId = await createManualScraperRun(context.cloudflare.env, admin);
		try {
			if (!context.cloudflare.env.SCRAPER_ADMIN_TOKEN) {
				throw new Error("The SCRAPER_ADMIN_TOKEN production secret is not configured.");
			}
			const response = await fetch(context.cloudflare.env.SCRAPER_RUN_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${context.cloudflare.env.SCRAPER_ADMIN_TOKEN}`,
					Accept: "application/json",
					"X-Scraper-Run-Id": runId,
				},
				signal: AbortSignal.timeout(120_000),
			});
			const text = await readSmallResponse(response);
			if (!response.ok) throw new Error(`Scraper returned ${response.status}${text ? `: ${text.slice(0, 500)}` : ""}`);
			const result = JSON.parse(text) as unknown;
			if (!result || typeof result !== "object" || Array.isArray(result)) {
				throw new Error("Scraper returned an invalid result.");
			}
			await finishManualScraperRun(context.cloudflare.env, runId, result as Record<string, unknown>);
			return { ok: true as const, message: "Scraper run completed. Review imported events below." };
		} catch (error) {
			const message = error instanceof Error ? error.message : "The scraper run failed.";
			await failManualScraperRun(context.cloudflare.env, runId, message);
			return { ok: false as const, error: message };
		}
	}

	const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
	if (!parsed.success) {
		return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check the scraper settings." };
	}
	try {
		await updateOrganizationScraperSettings(context.cloudflare.env, admin, parsed.data);
		return { ok: true as const, message: "Organization scraper settings saved." };
	} catch (error) {
		return { ok: false as const, error: error instanceof Error ? error.message : "The scraper settings could not be saved." };
	}
}

export default function AdminScraper({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const submitting = navigation.state === "submitting";
	const enabledCount = loaderData.organizations.filter((organization) => organization.eventScrapingEnabled === 1).length;
	return (
		<div className="admin-page scraper-admin-page">
			<section className="page-heading">
				<div>
					<p className="eyebrow">Event operations</p>
					<h1>Partner event scraper</h1>
					<p>Control event sources, run the scraper, and inspect every import before moderation.</p>
				</div>
				<Form method="post">
					<input name="intent" type="hidden" value="run" />
					<button className="button button--primary" disabled={submitting} type="submit">
						<Icon name="sparkles" size={17} />{submitting ? "Running…" : "Run scraper now"}
					</button>
				</Form>
			</section>
			{actionData && (actionData.ok
				? <p className="form-message form-message--success">{actionData.message}</p>
				: <p className="form-message form-message--error">{actionData.error}</p>)}

			<section className="scraper-summary-grid" aria-label="Scraper summary">
				<div className="panel"><strong>{enabledCount}</strong><span>Enabled sources</span></div>
				<div className="panel"><strong>{loaderData.imports.filter((item) => item.outcome === "imported" || item.outcome === "updated").length}</strong><span>Recent imports</span></div>
				<div className="panel"><strong>{loaderData.imports.filter((item) => item.outcome === "duplicate").length}</strong><span>Duplicates caught</span></div>
				<div className="panel"><strong>{loaderData.runs.filter((run) => run.status === "failed").length}</strong><span>Failed runs</span></div>
			</section>

			<section className="panel scraper-panel">
				<div className="panel-heading"><div><p className="eyebrow">Configuration</p><h2>Organization sources</h2></div><span>{enabledCount} enabled</span></div>
				<div className="scraper-source-list">
					{loaderData.organizations.map((organization) => (
						<Form className="scraper-source-row" key={organization.id} method="post">
							<input name="intent" type="hidden" value="save-settings" />
							<input name="organizationId" type="hidden" value={organization.id} />
							<div className="scraper-source-name"><strong>{organization.name}</strong><span className={`status-pill status-pill--${organization.status}`}>{organization.status}</span></div>
							<label>Event source URL<input defaultValue={organization.eventSourceUrl ?? ""} name="eventSourceUrl" placeholder="https://example.org/events" type="url" /></label>
							<label>Parser<select defaultValue={organization.eventParser ?? ""} name="eventParser"><option value="">Choose parser</option>{scraperParsers.map((parser) => <option key={parser} value={parser}>{parser.replaceAll("_", " ")}</option>)}</select></label>
							<label className="scraper-toggle"><input defaultChecked={organization.eventScrapingEnabled === 1} name="eventScrapingEnabled" type="checkbox" />Enabled</label>
							<button className="button button--secondary button--compact" disabled={submitting} type="submit">Save</button>
						</Form>
					))}
				</div>
			</section>

			<div className="scraper-operations-grid">
				<section className="panel scraper-panel">
					<div className="panel-heading"><div><p className="eyebrow">Execution</p><h2>Run history</h2></div><span>{loaderData.runs.length} recent</span></div>
					{loaderData.runs.length === 0 ? <p className="muted-empty scraper-empty">No scraper runs recorded yet.</p> : <div className="scraper-run-list">{loaderData.runs.map((run) => (
						<article key={run.id}><div><span className={`status-pill scraper-status--${run.status}`}>{run.status}</span><strong>{formatDateTime(run.startedAt)}</strong><small>{run.initiatedByName ? `Started by ${run.initiatedByName}` : run.triggerType}</small></div><p>{run.status === "failed" ? run.errorMessage : `${run.importedCount} imported · ${run.skippedCount} skipped · ${run.failureCount} failures`}</p></article>
					))}</div>}
				</section>

				<section className="panel scraper-panel">
					<div className="panel-heading"><div><p className="eyebrow">Review trail</p><h2>Recent import decisions</h2></div><Link to="/events/moderation">Moderation queue</Link></div>
					{loaderData.imports.length === 0 ? <p className="muted-empty scraper-empty">No import decisions recorded yet.</p> : <div className="scraper-import-list">{loaderData.imports.map((item) => (
						<article key={item.id}><span className={`status-pill scraper-outcome--${item.outcome}`}>{item.outcome}</span><div><strong>{item.postId ? <Link to={`/posts/${item.postId}`}>{item.title || "Untitled event"}</Link> : item.title || "Invalid record"}</strong><p>{item.organizationName || item.reason || "No organization match"}{item.startsAt ? ` · ${formatEventDateTime(item.startsAt)}` : ""}</p></div><time>{formatDateTime(item.createdAt)}</time></article>
					))}</div>}
				</section>
			</div>
		</div>
	);
}
