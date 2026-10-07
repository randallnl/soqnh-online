import { Form, Link, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/admin-spotlights";
import { Icon } from "~/components/icon";
import { requireSiteAdmin } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import { imageUploadAccept } from "~/lib/media";
import { deleteIdentityImage, ImageUploadError, requireUploadRequestSize, uploadIdentityImage } from "~/lib/media.server";
import {
	createPublicSpotlight,
	deletePublicSpotlight,
	listPublicSpotlightsForAdmin,
	PublicSpotlightMutationError,
	updatePublicSpotlight,
} from "~/models/public-spotlights.server";

const optionalText = (maximum: number) => z.preprocess(
	(value) => typeof value === "string" && value.trim() ? value.trim() : null,
	z.string().max(maximum).nullable(),
);
const optionalLink = z.preprocess(
	(value) => typeof value === "string" && value.trim() ? value.trim() : null,
	z.string().max(500).nullable().refine((value) => {
		if (!value || value.startsWith("/")) return true;
		try {
			const url = new URL(value);
			return url.protocol === "http:" || url.protocol === "https:";
		} catch {
			return false;
		}
	}, "Enter a site path or full http(s) URL"),
);
const spotlightFields = z.object({
	eyebrow: optionalText(100),
	headline: z.string().trim().min(3, "Add a headline").max(160),
	message: z.string().trim().min(10, "Add a little more detail").max(600),
	imageAlt: z.string().trim().min(3, "Describe the image for screen readers").max(240),
	photoCredit: optionalText(160),
	primaryButtonLabel: optionalText(60),
	primaryButtonUrl: optionalLink,
	secondaryButtonLabel: optionalText(60),
	secondaryButtonUrl: optionalLink,
	sortOrder: z.coerce.number().int().min(0).max(9999),
}).superRefine((value, context) => {
	for (const [labelKey, urlKey] of [["primaryButtonLabel", "primaryButtonUrl"], ["secondaryButtonLabel", "secondaryButtonUrl"]] as const) {
		if (Boolean(value[labelKey]) !== Boolean(value[urlKey])) context.addIssue({ code: "custom", path: [labelKey], message: "Add both a button label and destination, or leave both blank" });
	}
});
const createSchema = spotlightFields.and(z.object({ intent: z.literal("create") }));
const updateSchema = spotlightFields.and(z.object({ intent: z.literal("update"), spotlightId: z.string().uuid() }));
const deleteSchema = z.object({ intent: z.literal("delete"), spotlightId: z.string().uuid() });

export function meta() {
	return [{ title: "Homepage spotlights · NH Connect" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	await requireSiteAdmin(request, context.cloudflare.env);
	return { spotlights: await listPublicSpotlightsForAdmin(context.cloudflare.env) };
}

function uploadErrorMessage(error: ImageUploadError) {
	if (error.reason === "too-large") return "Upload an image smaller than 10 MB.";
	if (error.reason === "unsupported") return "Upload a PNG, JPG, WebP, or GIF image.";
	return "The uploaded file does not appear to be a valid image.";
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const admin = await requireSiteAdmin(request, context.cloudflare.env);
	try {
		requireUploadRequestSize(request);
	} catch (error) {
		if (error instanceof ImageUploadError) return { ok: false as const, error: uploadErrorMessage(error) };
		throw error;
	}
	const formData = await request.formData();
	const raw = Object.fromEntries(formData);
	const intent = raw.intent;
	try {
		if (intent === "delete") {
			const parsed = deleteSchema.safeParse(raw);
			if (!parsed.success) return { ok: false as const, error: "That spotlight is no longer available." };
			const imageObjectKey = await deletePublicSpotlight(context.cloudflare.env, admin, parsed.data.spotlightId);
			context.cloudflare.ctx.waitUntil(deleteIdentityImage(context.cloudflare.env, imageObjectKey));
			return { ok: true as const, message: "Spotlight deleted." };
		}

		const parsed = intent === "create" ? createSchema.safeParse(raw) : updateSchema.safeParse(raw);
		if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check the spotlight details." };
		const isActive = formData.get("isActive") === "on";
		if (parsed.data.intent === "create") {
			const id = crypto.randomUUID();
			const imageObjectKey = await uploadIdentityImage(context.cloudflare.env, formData.get("image"), "spotlight-images", id);
			if (!imageObjectKey) return { ok: false as const, error: "Choose a photo for this spotlight." };
			try {
				await createPublicSpotlight(context.cloudflare.env, admin, { ...parsed.data, id, imageObjectKey, isActive });
			} catch (error) {
				await deleteIdentityImage(context.cloudflare.env, imageObjectKey);
				throw error;
			}
			return { ok: true as const, message: "Spotlight created." };
		}

		const imageObjectKey = await uploadIdentityImage(context.cloudflare.env, formData.get("image"), "spotlight-images", parsed.data.spotlightId);
		try {
			const images = await updatePublicSpotlight(context.cloudflare.env, admin, { ...parsed.data, ...(imageObjectKey ? { imageObjectKey } : {}), isActive });
			if (imageObjectKey && images.previousImageObjectKey !== imageObjectKey) context.cloudflare.ctx.waitUntil(deleteIdentityImage(context.cloudflare.env, images.previousImageObjectKey));
		} catch (error) {
			if (imageObjectKey) await deleteIdentityImage(context.cloudflare.env, imageObjectKey);
			throw error;
		}
		return { ok: true as const, message: "Spotlight updated." };
	} catch (error) {
		if (error instanceof ImageUploadError) return { ok: false as const, error: uploadErrorMessage(error) };
		if (error instanceof PublicSpotlightMutationError) return { ok: false as const, error: error.reason === "forbidden" ? "Only site administrators can manage spotlights." : "That spotlight is no longer available." };
		console.error(JSON.stringify({ message: "spotlight administration failed", actorUserId: admin.id, error: error instanceof Error ? error.message : String(error) }));
		return { ok: false as const, error: "The spotlight change could not be saved." };
	}
}

function SpotlightFields({ spotlight }: { spotlight?: Awaited<ReturnType<typeof listPublicSpotlightsForAdmin>>[number] }) {
	return <>
		<label>Eyebrow text<input defaultValue={spotlight?.eyebrow ?? ""} maxLength={100} name="eyebrow" placeholder="Community spotlight" /></label>
		<label>Headline<input defaultValue={spotlight?.headline ?? ""} maxLength={160} name="headline" required /></label>
		<label className="wide-field">Message<textarea defaultValue={spotlight?.message ?? ""} maxLength={600} name="message" required rows={4} /></label>
		<label>Photo<input accept={imageUploadAccept} name="image" required={!spotlight} type="file" /><small>{spotlight ? "Leave blank to keep the current photo." : "Wide landscape photos work best."} Maximum 10 MB.</small></label>
		<label>Image description<input defaultValue={spotlight?.imageAlt ?? ""} maxLength={240} name="imageAlt" placeholder="Describe what is visible in the photo" required /><small>This is read aloud by screen readers.</small></label>
		<label>Photo credit<input defaultValue={spotlight?.photoCredit ?? ""} maxLength={160} name="photoCredit" placeholder="Photo by …" /></label>
		<label>Display order<input defaultValue={spotlight?.sortOrder ?? 0} min={0} max={9999} name="sortOrder" required type="number" /></label>
		<label>Primary button label<input defaultValue={spotlight?.primaryButtonLabel ?? ""} maxLength={60} name="primaryButtonLabel" placeholder="Learn more" /></label>
		<label>Primary button destination<input defaultValue={spotlight?.primaryButtonUrl ?? ""} maxLength={500} name="primaryButtonUrl" placeholder="/directory or https://…" /></label>
		<label>Secondary button label<input defaultValue={spotlight?.secondaryButtonLabel ?? ""} maxLength={60} name="secondaryButtonLabel" /></label>
		<label>Secondary button destination<input defaultValue={spotlight?.secondaryButtonUrl ?? ""} maxLength={500} name="secondaryButtonUrl" placeholder="/calendar or https://…" /></label>
		<label className="spotlight-active-field"><input defaultChecked={spotlight?.isActive === 1} name="isActive" type="checkbox" /><span><strong>Show on the public homepage</strong><small>Inactive spotlights remain saved for later.</small></span></label>
	</>;
}

export default function AdminSpotlights({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const submitting = navigation.state === "submitting";
	return <div className="admin-page spotlight-admin-page">
		<section className="page-heading"><div><p className="eyebrow">Public homepage</p><h1>Feature spotlights</h1><p>Create rotating hero slides for programs, community stories, events, and partner highlights.</p></div><Link className="button button--secondary heading-action" to="/" target="_blank">View public homepage</Link></section>
		{actionData && <p className={`form-message form-message--${actionData.ok ? "success" : "error"}`}>{actionData.ok ? actionData.message : actionData.error}</p>}

		<details className="panel spotlight-create-panel">
			<summary><span><p className="eyebrow">New feature</p><h2>Add a spotlight</h2></span><Icon name="plus" size={20} /></summary>
			<Form className="spotlight-admin-form" encType="multipart/form-data" method="post"><input name="intent" type="hidden" value="create" /><SpotlightFields /><button className="button button--primary wide-field" disabled={submitting} type="submit">Create spotlight</button></Form>
		</details>

		<section className="spotlight-admin-list">
			{loaderData.spotlights.length === 0 ? <div className="panel empty-state"><strong>No spotlights yet</strong><p>The existing homepage hero will remain visible until an active spotlight is added.</p></div> : loaderData.spotlights.map((spotlight) => <details className="panel spotlight-admin-card" key={spotlight.id}>
				<summary><img alt="" src={`/spotlights/${encodeURIComponent(spotlight.id)}/media`} /><span><strong>{spotlight.headline}</strong><small>Order {spotlight.sortOrder} · {spotlight.isActive === 1 ? "Visible on homepage" : "Inactive"}</small></span><span className={`status-pill status-pill--${spotlight.isActive === 1 ? "active" : "inactive"}`}>{spotlight.isActive === 1 ? "active" : "inactive"}</span><Icon name="chevron-right" size={18} /></summary>
				<div className="spotlight-admin-card-body">
					<Form className="spotlight-admin-form" encType="multipart/form-data" method="post"><input name="intent" type="hidden" value="update" /><input name="spotlightId" type="hidden" value={spotlight.id} /><SpotlightFields spotlight={spotlight} /><button className="button button--secondary wide-field" disabled={submitting} type="submit">Save spotlight</button></Form>
					<div className="spotlight-danger-zone"><div><strong>Delete spotlight</strong><p>Remove this spotlight and its uploaded photo permanently.</p></div><Form method="post" onSubmit={(event) => { if (!window.confirm(`Delete “${spotlight.headline}”?`)) event.preventDefault(); }}><input name="intent" type="hidden" value="delete" /><input name="spotlightId" type="hidden" value={spotlight.id} /><button className="member-action-button member-action-button--delete" disabled={submitting} type="submit">Delete</button></Form></div>
				</div>
			</details>)}
		</section>
	</div>;
}
