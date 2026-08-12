import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/invite-accept";
import { Icon } from "~/components/icon";
import { createUserSession } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import {
	acceptInvitation,
	getInvitationByToken,
} from "~/models/invitations.server";

const acceptanceSchema = z.object({
	token: z.string().regex(/^[a-f0-9]{64}$/i, "This invitation link is invalid"),
	name: z
		.string()
		.trim()
		.min(2, "Enter your full name")
		.max(100, "Keep your name under 100 characters"),
});

const roleLabels = {
	viewer: "viewer",
	contributor: "contributor",
	org_admin: "organization administrator",
} as const;

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Accept invitation · State of Queer NH" },
		{
			name: "description",
			content: "Accept an invitation to the private State of Queer NH workspace.",
		},
	];
}

export function headers() {
	return {
		"Cache-Control": "no-store",
		"Referrer-Policy": "no-referrer",
	};
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const token = new URL(request.url).searchParams.get("token");
	const invitation = token
		? await getInvitationByToken(context.cloudflare.env, token)
		: null;
	return { token: token ?? "", invitation };
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const formData = await request.formData();
	const result = acceptanceSchema.safeParse({
		token: formData.get("token"),
		name: formData.get("name"),
	});

	if (!result.success) {
		return {
			ok: false as const,
			error: result.error.issues[0]?.message ?? "Check your details",
		};
	}

	const user = await acceptInvitation(context.cloudflare.env, result.data);
	if (!user) {
		return {
			ok: false as const,
			error: "This invitation is invalid, expired, or has already been used.",
		};
	}

	const cookie = await createUserSession(context.cloudflare.env, user);
	throw redirect("/", { headers: { "Set-Cookie": cookie } });
}

export default function InviteAccept({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const submitting = navigation.state === "submitting";
	const { invitation } = loaderData;

	return (
		<main className="auth-page">
			<section className="auth-story">
				<div className="auth-story-inner">
					<Link className="brand-lockup" to="/">
						<span className="brand-mark" aria-hidden="true"><span /><span /></span>
						<span><strong>State of Queer</strong><small>New Hampshire</small></span>
					</Link>
					<div className="auth-quote">
						<span className="auth-quote-icon"><Icon name="people" size={24} /></span>
						<p className="eyebrow">Welcome to the ecosystem</p>
						<h1>Connect, coordinate, and build power together.</h1>
						<p>
							Your invitation opens the private workspace shared by New Hampshire’s queer community network.
						</p>
					</div>
					<p className="auth-footer">Invitation-only · Secure member access</p>
				</div>
			</section>

			<section className="auth-form-section">
				<div className="auth-form-card">
					<p className="eyebrow">Member invitation</p>
					{invitation ? (
						<>
							<h2>Finish joining</h2>
							<p>
								Your invitation is for <strong>{invitation.email}</strong>
								{invitation.organizationName
									? ` as a ${roleLabels[invitation.invitedRole]} at ${invitation.organizationName}.`
									: "."}
							</p>
							<Form className="auth-form" method="post">
								<input name="token" type="hidden" value={loaderData.token} />
								<label htmlFor="name">Full name</label>
								<div className="input-with-icon">
									<Icon name="user" size={18} />
									<input
										autoComplete="name"
										autoFocus
										id="name"
										name="name"
										placeholder="Your name"
										required
										type="text"
									/>
								</div>
								{actionData && !actionData.ok && (
									<p className="form-message form-message--error">{actionData.error}</p>
								)}
								<button
									className="button button--primary button--large"
									disabled={submitting}
									type="submit"
								>
									{submitting ? "Activating account…" : "Accept invitation"}
									<Icon name="chevron-right" size={18} />
								</button>
							</Form>
						</>
					) : (
						<>
							<h2>This link is no longer available</h2>
							<p>The invitation may have expired, already been accepted, or been replaced by a newer invitation.</p>
							<Link className="button button--secondary button--large invite-return" to="/login">
								Go to sign in
							</Link>
						</>
					)}
				</div>
			</section>
		</main>
	);
}
