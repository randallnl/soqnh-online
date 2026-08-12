import { Form, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/admin-invitations";
import { Icon } from "~/components/icon";
import { requireSiteAdmin } from "~/lib/auth.server";
import { sendInvitationEmail } from "~/lib/email.server";
import { requireSameOrigin } from "~/lib/http.server";
import { organizationRoles } from "~/lib/invitations";
import {
	auditInvitationDeliveryFailure,
	createInvitation,
	InvitationConflictError,
	invalidateInvitation,
	listActiveOrganizations,
	listRecentInvitations,
} from "~/models/invitations.server";

const invitationSchema = z.object({
	email: z.email("Enter a valid email address"),
	organizationId: z.string().max(100).optional(),
	invitedRole: z.enum(organizationRoles),
});

const roleLabels = {
	viewer: "Viewer",
	contributor: "Contributor",
	org_admin: "Organization admin",
} as const;

async function deliverInvitation(
	env: Env,
	input: {
		invitationId: string;
		actorUserId: string;
		email: string;
		token: string;
		organizationName: string | null;
	},
) {
	try {
		await sendInvitationEmail(env, {
			to: input.email,
			token: input.token,
			organizationName: input.organizationName,
		});
	} catch (error) {
		try {
			await invalidateInvitation(env, input.invitationId);
			await auditInvitationDeliveryFailure(env, {
				invitationId: input.invitationId,
				actorUserId: input.actorUserId,
			});
		} catch (cleanupError) {
			console.error(
				JSON.stringify({
					message: "invitation delivery cleanup failed",
					invitationId: input.invitationId,
					error:
						cleanupError instanceof Error
							? cleanupError.message
							: String(cleanupError),
				}),
			);
		}
		console.error(
			JSON.stringify({
				message: "invitation delivery failed",
				invitationId: input.invitationId,
				error: error instanceof Error ? error.message : String(error),
			}),
		);
	}
}

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Invitations · State of Queer NH" },
		{
			name: "description",
			content: "Invite members to the private State of Queer NH workspace.",
		},
	];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	await requireSiteAdmin(request, context.cloudflare.env);
	const [organizations, invitations] = await Promise.all([
		listActiveOrganizations(context.cloudflare.env),
		listRecentInvitations(context.cloudflare.env),
	]);
	return { organizations, invitations };
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const admin = await requireSiteAdmin(request, context.cloudflare.env);
	const formData = await request.formData();
	const result = invitationSchema.safeParse({
		email: formData.get("email"),
		organizationId: formData.get("organizationId") || undefined,
		invitedRole: formData.get("invitedRole"),
	});

	if (!result.success) {
		return {
			ok: false as const,
			error: result.error.issues[0]?.message ?? "Check the invitation details",
		};
	}

	const organizationId = result.data.organizationId ?? null;
	const organizations = organizationId
		? await listActiveOrganizations(context.cloudflare.env)
		: [];
	const organization = organizations.find((item) => item.id === organizationId);

	try {
		const invitation = await createInvitation(context.cloudflare.env, admin, {
			email: result.data.email,
			organizationId,
			invitedRole: result.data.invitedRole,
		});

		context.cloudflare.ctx.waitUntil(
			deliverInvitation(context.cloudflare.env, {
				invitationId: invitation.id,
				actorUserId: admin.id,
				email: invitation.email,
				token: invitation.token,
				organizationName: organization?.name ?? null,
			}),
		);

		return {
			ok: true as const,
			message: `Invitation queued for ${invitation.email}.`,
		};
	} catch (error) {
		if (error instanceof InvitationConflictError) {
			const messages = {
				active: "That email address already belongs to an active member.",
				suspended:
					"That account is suspended. Restore it from member management instead.",
				"organization-unavailable":
					"That organization is not available for invitations.",
			};
			return { ok: false as const, error: messages[error.reason] };
		}

		console.error(
			JSON.stringify({
				message: "invitation creation failed",
				actorUserId: admin.id,
				error: error instanceof Error ? error.message : String(error),
			}),
		);
		return {
			ok: false as const,
			error: "The invitation could not be created. Please try again.",
		};
	}
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(value));
}

export default function AdminInvitations({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const submitting = navigation.state === "submitting";

	return (
		<div className="admin-page">
			<section className="page-heading">
				<div>
					<p className="eyebrow">Site administration</p>
					<h1>Member invitations</h1>
					<p>Grant access to the private workspace and, optionally, an organization.</p>
				</div>
			</section>

			<div className="admin-grid">
				<section className="panel invitation-form-panel">
					<div className="panel-heading">
						<div>
							<p className="eyebrow">New invitation</p>
							<h2>Invite a member</h2>
						</div>
					</div>
					<Form className="admin-form" method="post">
						<label htmlFor="email">Email address</label>
						<input
							autoComplete="email"
							id="email"
							name="email"
							placeholder="member@example.org"
							required
							type="email"
						/>

						<label htmlFor="organizationId">Organization (optional)</label>
						<select id="organizationId" name="organizationId">
							<option value="">Workspace access only</option>
							{loaderData.organizations.map((organization) => (
								<option key={organization.id} value={organization.id}>
									{organization.name}
								</option>
							))}
						</select>

						<label htmlFor="invitedRole">Organization role</label>
						<select defaultValue="viewer" id="invitedRole" name="invitedRole">
							{organizationRoles.map((role) => (
								<option key={role} value={role}>
									{roleLabels[role]}
								</option>
							))}
						</select>
						<p className="field-help">
							The role applies only when an organization is selected.
						</p>

						{actionData && (
							<p
								className={`form-message form-message--${actionData.ok ? "success" : "error"}`}
							>
								{actionData.ok ? actionData.message : actionData.error}
							</p>
						)}

						<button
							className="button button--primary button--large"
							disabled={submitting}
							type="submit"
						>
							<Icon name="plus" size={18} />
							{submitting ? "Creating invitation…" : "Send invitation"}
						</button>
					</Form>
				</section>

				<section className="panel invitation-list-panel">
					<div className="panel-heading">
						<div>
							<p className="eyebrow">Access history</p>
							<h2>Recent invitations</h2>
						</div>
					</div>
					{loaderData.invitations.length === 0 ? (
						<div className="empty-state">
							<Icon name="message" size={24} />
							<strong>No invitations yet</strong>
							<p>The first invitation you create will appear here.</p>
						</div>
					) : (
						<div className="invitation-list">
							{loaderData.invitations.map((invitation) => (
								<article className="invitation-row" key={invitation.id}>
									<div>
										<strong>{invitation.email}</strong>
										<p>
											{invitation.organizationName
												? `${invitation.organizationName} · ${roleLabels[invitation.invitedRole]}`
												: "Workspace member"}
										</p>
									</div>
									<div className="invitation-status">
										<span className={`status-pill status-pill--${invitation.status}`}>
											{invitation.status}
										</span>
										<small>{formatDate(invitation.createdAt)}</small>
									</div>
								</article>
							))}
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
