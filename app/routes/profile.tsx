import { Form, Link, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/profile";
import { IdentityAvatar } from "~/components/identity-avatar";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import { deleteIdentityImage, ImageUploadError, requireUploadRequestSize, uploadIdentityImage } from "~/lib/media.server";
import { getOwnProfileEditorData, updateOwnProfile } from "~/models/profiles.server";

const optionalText = (maximum: number) => z.preprocess(
	(value) => typeof value === "string" && value.trim() ? value.trim() : null,
	z.string().max(maximum).nullable(),
);
const profileSchema = z.object({
	intent: z.literal("update-profile"),
	name: z.string().trim().min(2, "Enter the name members should see").max(120),
	profileTitle: optionalText(160),
	pronouns: optionalText(80),
	bio: optionalText(2000),
	location: optionalText(160),
	websiteUrl: z.preprocess(
		(value) => typeof value === "string" && value.trim() ? value.trim() : null,
		z.url("Enter a complete website URL").max(500).nullable(),
	),
	profileVisibility: z.enum(["members", "hidden"]),
});

function uploadMessage(error: ImageUploadError) {
	return error.reason === "too-large" ? "Upload an image smaller than 2 MB."
		: error.reason === "unsupported" ? "Upload a PNG, JPG, WebP, or GIF image."
		: "The uploaded file does not appear to be a valid image.";
}

export function meta() {
	return [{ title: "Edit profile · State of Queer NH" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const data = await getOwnProfileEditorData(context.cloudflare.env, user);
	if (!data.profile) throw new Response("Profile not found", { status: 404 });
	return {
		user,
		profile: data.profile,
		affiliations: data.affiliations,
		directAffiliationIds: data.directAffiliationIds,
	};
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	try {
		requireUploadRequestSize(request);
		const formData = await request.formData();
		const editor = await getOwnProfileEditorData(context.cloudflare.env, user);
		if (!editor.profile) throw new Response("Profile not found", { status: 404 });
		const intent = formData.get("intent");
		if (intent === "remove-avatar") {
			await updateOwnProfile(context.cloudflare.env, user, {
				name: editor.profile.name ?? "Member",
				profileTitle: editor.profile.profileTitle,
				pronouns: editor.profile.pronouns,
				bio: editor.profile.bio,
				location: editor.profile.location,
				websiteUrl: editor.profile.websiteUrl,
				profileVisibility: editor.profile.profileVisibility,
				affiliationIds: editor.directAffiliationIds,
				avatarObjectKey: null,
			});
			context.cloudflare.ctx.waitUntil(deleteIdentityImage(context.cloudflare.env, editor.profile.avatarObjectKey));
			return { ok: true as const, message: "Profile photo removed." };
		}
		const parsed = profileSchema.safeParse(Object.fromEntries(formData));
		if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check your profile details." };
		const selectedAffiliations = [...new Set(formData.getAll("affiliationId").filter((value): value is string => typeof value === "string" && value.length > 0))];
		const newAvatarKey = await uploadIdentityImage(context.cloudflare.env, formData.get("avatar"), "profile-photos", user.id);
		try {
			await updateOwnProfile(context.cloudflare.env, user, {
				...parsed.data,
				affiliationIds: selectedAffiliations,
				avatarObjectKey: newAvatarKey ?? editor.profile.avatarObjectKey,
			});
		} catch (error) {
			if (newAvatarKey) await deleteIdentityImage(context.cloudflare.env, newAvatarKey);
			throw error;
		}
		if (newAvatarKey && editor.profile.avatarObjectKey) context.cloudflare.ctx.waitUntil(deleteIdentityImage(context.cloudflare.env, editor.profile.avatarObjectKey));
		return { ok: true as const, message: "Profile updated." };
	} catch (error) {
		if (error instanceof Response) throw error;
		if (error instanceof ImageUploadError) return { ok: false as const, error: uploadMessage(error) };
		console.error(JSON.stringify({ message: "profile update failed", actorUserId: user.id, error: error instanceof Error ? error.message : String(error) }));
		return { ok: false as const, error: "Your profile could not be saved." };
	}
}

export default function Profile({ loaderData }: Route.ComponentProps) {
	const { profile } = loaderData;
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const submitting = navigation.state === "submitting";
	return <div className="profile-edit-page"><section className="page-heading"><div><p className="eyebrow">Your profile</p><h1>Edit profile</h1><p>Choose how you appear to collaborators across the member network.</p></div><Link className="button button--secondary" to={`/members/${profile.id}`}>View profile</Link></section>
		{actionData && <p className={`form-message form-message--${actionData.ok ? "success" : "error"}`}>{actionData.ok ? actionData.message : actionData.error}</p>}
		<section className="panel profile-editor-panel"><div className="profile-photo-editor"><IdentityAvatar name={profile.name} objectKey={profile.avatarObjectKey} size="large" /><div><strong>Profile photo</strong><p>PNG, JPG, WebP, or GIF. Maximum 2 MB.</p>{profile.avatarObjectKey && <Form method="post"><input name="intent" type="hidden" value="remove-avatar" /><button className="member-action-button member-action-button--suspend" disabled={submitting} type="submit">Remove photo</button></Form>}</div></div>
			<Form className="profile-editor-form" encType="multipart/form-data" method="post"><input name="intent" type="hidden" value="update-profile" />
				<label>Profile photo<input accept="image/png,image/jpeg,image/webp,image/gif" name="avatar" type="file" /></label><label>Name<input defaultValue={profile.name ?? ""} maxLength={120} name="name" required /></label><label>Role or title<input defaultValue={profile.profileTitle ?? ""} maxLength={160} name="profileTitle" placeholder="Organizer, policy lead, volunteer coordinator…" /></label><label>Pronouns<input defaultValue={profile.pronouns ?? ""} maxLength={80} name="pronouns" /></label><label>Location<input defaultValue={profile.location ?? ""} maxLength={160} name="location" /></label><label>Website<input defaultValue={profile.websiteUrl ?? ""} maxLength={500} name="websiteUrl" type="url" /></label><label>Directory visibility<select defaultValue={profile.profileVisibility} name="profileVisibility"><option value="members">Visible to members in my affiliations</option><option value="hidden">Hidden from the member directory</option></select></label><label className="wide-field">Bio<textarea defaultValue={profile.bio ?? ""} maxLength={2000} name="bio" rows={6} /></label>
				<fieldset className="profile-affiliation-picker wide-field"><legend>Your direct affiliations</legend><p>Organization affiliations are inherited automatically. Choose any additional coalitions you participate in directly.</p><div>{loaderData.affiliations.map((affiliation) => <label key={affiliation.id}><input defaultChecked={loaderData.directAffiliationIds.includes(affiliation.id)} name="affiliationId" type="checkbox" value={affiliation.id} />{affiliation.name}</label>)}</div></fieldset>
				<button className="button button--primary" disabled={submitting} type="submit">{submitting ? "Saving…" : "Save profile"}</button>
			</Form>
		</section>
	</div>;
}
