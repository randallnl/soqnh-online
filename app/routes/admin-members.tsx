import { useMemo, useState } from "react";
import { Form, Link, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/admin-members";
import { Icon } from "~/components/icon";
import { requireSiteAdmin } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import {
	changeMemberStatus,
	getMemberStatusCounts,
	listManagedMembers,
	listMemberAccessAudit,
	MemberStatusError,
} from "~/models/members.server";

const memberStatusSchema = z.object({
	targetUserId: z
		.string()
		.trim()
		.min(1, "That member could not be identified")
		.max(100, "That member could not be identified"),
	nextStatus: z.enum(["active", "suspended"]),
});

const statusLabels = {
	active: "Active",
	invited: "Invited",
	suspended: "Suspended",
} as const;

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Member access · State of Queer NH" },
		{
			name: "description",
			content: "Manage member access to the private State of Queer NH workspace.",
		},
	];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const admin = await requireSiteAdmin(request, context.cloudflare.env);
	const [members, counts, auditEvents] = await Promise.all([
		listManagedMembers(context.cloudflare.env),
		getMemberStatusCounts(context.cloudflare.env),
		listMemberAccessAudit(context.cloudflare.env),
	]);
	return { currentAdminId: admin.id, members, counts, auditEvents };
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const admin = await requireSiteAdmin(request, context.cloudflare.env);
	const formData = await request.formData();
	const result = memberStatusSchema.safeParse({
		targetUserId: formData.get("targetUserId"),
		nextStatus: formData.get("nextStatus"),
	});

	if (!result.success) {
		return {
			ok: false as const,
			error: result.error.issues[0]?.message ?? "Check the member action",
		};
	}

	try {
		const change = await changeMemberStatus(
			context.cloudflare.env,
			admin,
			result.data,
		);
		return {
			ok: true as const,
			message:
				change.nextStatus === "suspended"
					? "Member access suspended and active sessions revoked."
					: "Member access restored. They can sign in again.",
		};
	} catch (error) {
		if (error instanceof MemberStatusError) {
			const messages = {
				"not-found": "That member no longer exists.",
				"invalid-transition": "That member’s access has already changed.",
				"self-suspension": "You cannot suspend your own administrator account.",
				"last-site-admin": "The last active site administrator cannot be suspended.",
			};
			return { ok: false as const, error: messages[error.reason] };
		}

		console.error(
			JSON.stringify({
				message: "member status change failed",
				actorUserId: admin.id,
				targetUserId: result.data.targetUserId,
				error: error instanceof Error ? error.message : String(error),
			}),
		);
		return {
			ok: false as const,
			error: "Member access could not be updated. Please try again.",
		};
	}
}

function getInitials(name: string | null, email: string) {
	const source = name?.trim() || email.split("@")[0] || "Member";
	return source
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("");
}

function formatDate(value: string | null) {
	if (!value) return "Never";
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "America/New_York",
	}).format(new Date(value));
}

function formatDateTime(value: string) {
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZone: "America/New_York",
	}).format(new Date(value));
}

export default function AdminMembers({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const [query, setQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<
		"all" | "active" | "invited" | "suspended"
	>("all");
	const normalizedQuery = query.trim().toLowerCase();
	const filteredMembers = useMemo(
		() =>
			loaderData.members.filter((member) => {
				if (statusFilter !== "all" && member.status !== statusFilter) return false;
				if (!normalizedQuery) return true;
				return [member.name, member.email, member.organizations]
					.filter(Boolean)
					.some((value) => value?.toLowerCase().includes(normalizedQuery));
			}),
		[loaderData.members, normalizedQuery, statusFilter],
	);
	const submittingUserId =
		navigation.state === "submitting"
			? String(navigation.formData?.get("targetUserId") ?? "")
			: null;
	const filters = [
		{ value: "all" as const, label: "All", count: loaderData.counts.total },
		{ value: "active" as const, label: "Active", count: loaderData.counts.active },
		{ value: "invited" as const, label: "Invited", count: loaderData.counts.invited },
		{
			value: "suspended" as const,
			label: "Suspended",
			count: loaderData.counts.suspended,
		},
	];

	return (
		<div className="admin-page member-admin-page">
			<section className="page-heading">
				<div>
					<p className="eyebrow">Site administration</p>
					<h1>Member access</h1>
					<p>Review account status and control access to the private workspace.</p>
				</div>
				<Link className="button button--primary heading-action" to="/admin/invitations">
					<Icon name="plus" size={17} />
					Invite a member
				</Link>
			</section>

			{actionData && (
				<p
					className={`admin-notice form-message form-message--${actionData.ok ? "success" : "error"}`}
				>
					{actionData.ok ? actionData.message : actionData.error}
				</p>
			)}

			<section className="panel member-directory-panel">
				<div className="member-toolbar">
					<div className="member-filters" role="group" aria-label="Filter members by status">
						{filters.map((filter) => (
							<button
								className={statusFilter === filter.value ? "is-active" : ""}
								key={filter.value}
								onClick={() => setStatusFilter(filter.value)}
								type="button"
							>
								{filter.label} <span>{filter.count}</span>
							</button>
						))}
					</div>
					<label className="member-search">
						<span className="sr-only">Search members</span>
						<Icon name="search" size={17} />
						<input
							onChange={(event) => setQuery(event.currentTarget.value)}
							placeholder="Search members or organizations"
							type="search"
							value={query}
						/>
					</label>
				</div>

				{filteredMembers.length === 0 ? (
					<div className="empty-state">
						<Icon name="people" size={24} />
						<strong>No members match</strong>
						<p>Try a different name, email, organization, or status.</p>
					</div>
				) : (
					<div className="member-list">
						<div className="member-list-header" aria-hidden="true">
							<span>Member</span>
							<span>Organizations</span>
							<span>Last active</span>
							<span>Status</span>
							<span>Action</span>
						</div>
						{filteredMembers.map((member) => {
							const isCurrentAdmin = member.id === loaderData.currentAdminId;
							const isProtectedLastAdmin =
								member.siteRole === "site_admin" &&
								member.status === "active" &&
								loaderData.counts.activeSiteAdmins <= 1;
							const canSuspend =
								member.status === "active" && !isCurrentAdmin && !isProtectedLastAdmin;

							return (
								<article className="member-row" key={member.id}>
									<div className="member-identity">
										<span className="avatar">{getInitials(member.name, member.email)}</span>
										<div>
											<strong>{member.name || "Name not set"}</strong>
											<p>{member.email}</p>
											{member.siteRole === "site_admin" && <small>Site administrator</small>}
										</div>
									</div>
									<p className="member-organizations" data-label="Organizations">
										{member.organizations || "Workspace only"}
									</p>
									<p className="member-last-seen" data-label="Last active">
										{formatDate(member.lastSeenAt)}
									</p>
									<div data-label="Status">
										<span className={`status-pill status-pill--${member.status}`}>
											{statusLabels[member.status]}
										</span>
									</div>
									<div className="member-action" data-label="Action">
										{member.status === "suspended" ? (
											<Form method="post">
												<input name="targetUserId" type="hidden" value={member.id} />
												<input name="nextStatus" type="hidden" value="active" />
												<button className="member-action-button member-action-button--restore" disabled={submittingUserId === member.id} type="submit">
													{submittingUserId === member.id ? "Restoring…" : "Restore"}
												</button>
											</Form>
										) : member.status === "active" ? (
											<Form
												method="post"
												onSubmit={(event) => {
													if (!window.confirm(`Suspend access for ${member.name || member.email}?`)) {
														event.preventDefault();
													}
												}}
											>
												<input name="targetUserId" type="hidden" value={member.id} />
												<input name="nextStatus" type="hidden" value="suspended" />
												<button
													className="member-action-button member-action-button--suspend"
													disabled={!canSuspend || submittingUserId === member.id}
													title={
														isCurrentAdmin
															? "You cannot suspend your own account"
															: isProtectedLastAdmin
																? "The last site administrator must remain active"
																: undefined
													}
													type="submit"
												>
													{submittingUserId === member.id ? "Suspending…" : "Suspend"}
												</button>
											</Form>
										) : (
											<Link className="member-action-button" to="/admin/invitations">Reissue invite</Link>
										)}
									</div>
								</article>
							);
						})}
					</div>
				)}
			</section>

			<section className="panel member-audit-panel">
				<div className="panel-heading">
					<div>
						<p className="eyebrow">Accountability</p>
						<h2>Recent access changes</h2>
					</div>
				</div>
				{loaderData.auditEvents.length === 0 ? (
					<div className="empty-state empty-state--compact">
						<Icon name="activity" size={22} />
						<strong>No access changes yet</strong>
					</div>
				) : (
					<div className="audit-list">
						{loaderData.auditEvents.map((event) => (
							<article className="audit-row" key={event.id}>
								<span className={`audit-icon audit-icon--${event.action === "member.suspended" ? "suspended" : "restored"}`}>
									<Icon name={event.action === "member.suspended" ? "x" : "activity"} size={15} />
								</span>
								<p>
									<strong>{event.actorName || event.actorEmail}</strong>{" "}
									{event.action === "member.suspended" ? "suspended" : "restored"}{" "}
									<strong>{event.targetName || event.targetEmail}</strong>
								</p>
								<time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
							</article>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
