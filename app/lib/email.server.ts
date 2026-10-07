const SENDER_NAME = "NH Connect";

type InvitationRole = "viewer" | "contributor" | "org_admin";

const invitationRoleLabels: Record<InvitationRole, string> = {
	viewer: "Member",
	contributor: "Contributor",
	org_admin: "Organization administrator",
};

function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

export async function sendMagicLinkEmail(
	env: Env,
	input: {
		to: string;
		token: string;
		returnTo: string;
	},
) {
	const appOrigin = env.APP_ORIGIN.replace(/\/$/, "");
	const url = new URL("/auth/verify", appOrigin);
	url.searchParams.set("token", input.token);
	url.searchParams.set("returnTo", input.returnTo);
	const link = url.toString();
	const content = createMagicLinkEmailContent({
		link,
		logoUrl: new URL("/brand/queerlective-round.png", `${appOrigin}/`).toString(),
	});

	return env.EMAIL.send({
		to: input.to,
		from: { email: env.EMAIL_FROM, name: SENDER_NAME },
		subject: content.subject,
		text: content.text,
		html: content.html,
	});
}

export function createMagicLinkEmailContent(input: { link: string; logoUrl: string }) {
	const safeLink = escapeHtml(input.link);
	const safeLogoUrl = escapeHtml(input.logoUrl);
	const subject = "Your secure NH Connect sign-in link";

	return {
		subject,
		text: [
			"Your secure NH Connect sign-in link is ready",
			"",
			"Use this link to open your private NH Connect workspace:",
			input.link,
			"",
			"For your security:",
			"• This link expires in 15 minutes.",
			"• It can only be used once.",
			"• Please do not forward or share it.",
			"",
			"If you did not request this sign-in link, you can safely ignore this email. Your account will remain secure.",
			"",
			"NH Connect · A Queerlective initiative",
		].join("\n"),
		html: [
			'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
			'<body style="margin:0;padding:0;background:#fff9ed;color:#211333;font-family:Arial,Helvetica,sans-serif;line-height:1.6">',
			'<div style="display:none;max-height:0;overflow:hidden;opacity:0">Your secure, one-time NH Connect sign-in link is ready.</div>',
			'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#fff9ed"><tr><td align="center" style="padding:32px 16px">',
			'<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;overflow:hidden;border:1px solid #dfd7c9;border-radius:18px;background:#fffef8">',
			'<tr><td style="height:8px;background:#754595;font-size:0;line-height:0">&nbsp;</td></tr>',
			'<tr><td style="padding:28px 32px 18px">',
			'<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>',
			`<td style="padding-right:14px;vertical-align:middle"><img src="${safeLogoUrl}" width="56" height="56" alt="Queerlective" style="display:block;width:56px;height:56px;border:0;border-radius:50%"></td>`,
			'<td style="vertical-align:middle"><strong style="display:block;color:#211333;font-family:Georgia,Times New Roman,serif;font-size:24px;line-height:1.1">NH Connect</strong><span style="display:block;margin-top:4px;color:#9f2d69;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Private member access</span></td>',
			'</tr></table>',
			'</td></tr>',
			'<tr><td style="padding:4px 32px 32px">',
			'<h1 style="margin:0;color:#211333;font-family:Georgia,Times New Roman,serif;font-size:30px;line-height:1.2">Your sign-in link is ready</h1>',
			'<p style="margin:14px 0 24px;color:#62566d;font-size:16px">Use the secure button below to open NH Connect and continue to your private community workspace.</p>',
			`<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:10px;background:#5b3178"><a href="${safeLink}" style="display:inline-block;padding:13px 21px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none">Sign in to NH Connect</a></td></tr></table>`,
			'<div style="margin-top:26px;padding:17px 18px;border:1px solid #e8a9c7;border-radius:12px;background:#fff0f6">',
			'<strong style="display:block;color:#44275f;font-size:14px">For your security</strong>',
			'<p style="margin:5px 0 0;color:#62566d;font-size:14px">This link expires in 15 minutes, can only be used once, and should not be forwarded or shared.</p>',
			'</div>',
			`<p style="margin:22px 0 0;color:#69636f;font-size:13px">If the button does not work, copy and paste this address into your browser:<br><a href="${safeLink}" style="color:#5b3178;word-break:break-all">${safeLink}</a></p>`,
			'<p style="margin:20px 0 0;color:#69636f;font-size:13px">If you did not request this sign-in link, you can safely ignore this email. Your account will remain secure.</p>',
			'</td></tr>',
			'<tr><td style="padding:18px 32px;border-top:1px solid #eee7da;background:#f7effa;color:#62566d;font-size:12px">NH Connect &middot; A Queerlective initiative</td></tr>',
			'</table></td></tr></table></body></html>',
		].join(""),
	};
}

export async function sendInvitationEmail(
	env: Env,
	input: {
		to: string;
		token: string;
		organizationName: string | null;
		invitedRole: InvitationRole;
		invitedByName: string | null;
	},
) {
	const appOrigin = env.APP_ORIGIN.replace(/\/$/, "");
	const url = new URL("/invite/accept", appOrigin);
	url.searchParams.set("token", input.token);
	const link = url.toString();
	const content = createInvitationEmailContent({ ...input, link });

	return env.EMAIL.send({
		to: input.to,
		from: { email: env.EMAIL_FROM, name: SENDER_NAME },
		subject: content.subject,
		text: content.text,
		html: content.html,
	});
}

export function createInvitationEmailContent(input: {
	link: string;
	organizationName: string | null;
	invitedRole: InvitationRole;
	invitedByName: string | null;
}) {
	const roleLabel = invitationRoleLabels[input.invitedRole];
	const invitationContext = input.organizationName
		? `You are invited to participate as a ${roleLabel} with ${input.organizationName}.`
		: "You are invited to join the statewide member network.";
	const inviterCopy = input.invitedByName
		? `${input.invitedByName} invited you to join.`
		: "An NH Connect administrator invited you to join.";
	const safeLink = escapeHtml(input.link);
	const safeContext = escapeHtml(invitationContext);
	const safeInviter = escapeHtml(inviterCopy);
	const subject = "You’re invited to NH Connect";

	return {
		subject,
		text: [
			"You’re invited to NH Connect",
			"",
			inviterCopy,
			invitationContext,
			"",
			"NH Connect is a private coordination workspace for New Hampshire’s queer community network. Members can share updates, coordinate projects, find community events, and connect with organizations in their network.",
			"",
			"What happens next:",
			"1. Open the secure invitation link below.",
			"2. Confirm your name and activate your account.",
			"3. Complete your member profile before entering the workspace.",
			"4. You will see content and organizations available through your affiliations and approved organization memberships.",
			"",
			"Accept your invitation:",
			input.link,
			"",
			"This link is single-use and expires in 7 days. Please do not forward it. Your affiliation assignments are private and are visible only to you and site administrators.",
			"",
			"If you were not expecting this invitation, you can safely ignore this email or contact the person who invited you.",
		].join("\n"),
		html: [
			'<div style="margin:0;padding:32px 20px;background:#f6f8f6;color:#14231f;font-family:Arial,sans-serif;line-height:1.6">',
			'<div style="max-width:620px;margin:0 auto;padding:32px;background:#ffffff;border:1px solid #d8e0dc;border-radius:14px">',
			'<p style="margin:0 0 8px;color:#266d5e;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Private community invitation</p>',
			'<h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:30px;line-height:1.2">You’re invited to NH Connect</h1>',
			`<p style="margin:0 0 8px"><strong>${safeInviter}</strong></p>`,
			`<p style="margin:0 0 22px">${safeContext}</p>`,
			'<p style="margin:0 0 22px">NH Connect is a private coordination workspace for New Hampshire’s queer community network. Members can share updates, coordinate projects, find community events, and connect with organizations in their network.</p>',
			'<h2 style="margin:0 0 10px;font-family:Georgia,serif;font-size:20px">What happens next</h2>',
			'<ol style="margin:0 0 24px;padding-left:22px"><li>Open your secure invitation.</li><li>Confirm your name and activate your account.</li><li>Complete your member profile.</li><li>Enter the workspace and see content available through your approved network.</li></ol>',
			`<p style="margin:0 0 24px"><a href="${safeLink}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#1d5a4e;color:#ffffff;font-weight:700;text-decoration:none">Accept your invitation</a></p>`,
			'<div style="padding:16px;border-radius:10px;background:#edf6f2;font-size:14px"><strong>Privacy and security</strong><p style="margin:6px 0 0">This link is single-use and expires in 7 days. Please do not forward it. Your affiliation assignments are visible only to you and site administrators.</p></div>',
			`<p style="margin:20px 0 0;color:#5a6f68;font-size:13px">If the button does not work, copy and paste this address into your browser:<br><a href="${safeLink}" style="color:#266d5e;word-break:break-all">${safeLink}</a></p>`,
			'<p style="margin:18px 0 0;color:#5a6f68;font-size:13px">If you were not expecting this invitation, you can safely ignore this email or contact the person who invited you.</p>',
			"</div></div>",
		].join(""),
	};
}

export type WeeklyDigestItem = {
	id: string;
	title: string;
	organizationName: string | null;
	createdAt: string;
	eventStartsAt?: string | null;
};

function memberUrl(env: Env, path: string) {
	return new URL(path, `${env.APP_ORIGIN.replace(/\/$/, "")}/`).toString();
}

function formatEmailDate(value: string) {
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "America/New_York",
	}).format(new Date(value));
}

export function createMentionEmailContent(input: {
	recipientName: string | null;
	actorName: string;
	kind: "update" | "comment";
	link: string;
	preferencesLink: string;
}) {
	const safeActorName = escapeHtml(input.actorName);
	const safeLink = escapeHtml(input.link);
	const safePreferencesLink = escapeHtml(input.preferencesLink);
	const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hello,";
	const safeGreeting = escapeHtml(greeting);
	const location = input.kind === "comment" ? "a comment" : "a community update";
	const subject = `${input.actorName} mentioned you on NH Connect`;
	return {
		subject,
		text: [
			greeting,
			"",
			`${input.actorName} mentioned you in ${location}.`,
			"",
			"Open the conversation:",
			input.link,
			"",
			`Manage notification preferences: ${input.preferencesLink}`,
			"",
			"NH Connect · A Queerlective initiative",
		].join("\n"),
		html: [
			'<div style="margin:0;padding:30px 18px;background:#fff9ed;color:#211333;font-family:Arial,Helvetica,sans-serif;line-height:1.6">',
			'<div style="max-width:600px;margin:0 auto;overflow:hidden;border:1px solid #dfd7c9;border-radius:16px;background:#fffef8">',
			'<div style="height:7px;background:#754595"></div><div style="padding:28px 30px">',
			'<p style="margin:0 0 8px;color:#9f2d69;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">You were tagged</p>',
			`<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:27px;line-height:1.25">${safeActorName} mentioned you</h1>`,
			`<p style="margin:0 0 8px">${safeGreeting}</p><p style="margin:0 0 22px;color:#62566d">${safeActorName} tagged you in ${location} on NH Connect.</p>`,
			`<a href="${safeLink}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#5b3178;color:#fff;font-weight:700;text-decoration:none">Open the conversation</a>`,
			`<p style="margin:24px 0 0;color:#69636f;font-size:12px">You can change mention emails and weekly digests in your <a href="${safePreferencesLink}" style="color:#5b3178">notification preferences</a>.</p>`,
			'</div><div style="padding:16px 30px;border-top:1px solid #eee7da;background:#f7effa;color:#62566d;font-size:12px">NH Connect &middot; A Queerlective initiative</div></div></div>',
		].join(""),
	};
}

export async function sendMentionEmail(env: Env, input: {
	to: string;
	recipientName: string | null;
	actorName: string;
	kind: "update" | "comment";
	postId: string;
	commentId?: string | null;
}) {
	const path = `/posts/${input.postId}${input.commentId ? `#comment-${input.commentId}` : ""}`;
	const content = createMentionEmailContent({
		recipientName: input.recipientName,
		actorName: input.actorName,
		kind: input.kind,
		link: memberUrl(env, path),
		preferencesLink: memberUrl(env, "/profile"),
	});
	return env.EMAIL.send({
		to: input.to,
		from: { email: env.EMAIL_FROM, name: SENDER_NAME },
		subject: content.subject,
		text: content.text,
		html: content.html,
	});
}

function digestSectionText(title: string, items: WeeklyDigestItem[], appOrigin: string, useEventDate = false) {
	if (items.length === 0) return `${title}\nNothing new to share this week.`;
	return [title, ...items.map((item) => {
		const detail = item.organizationName ? ` · ${item.organizationName}` : "";
		const date = formatEmailDate(useEventDate && item.eventStartsAt ? item.eventStartsAt : item.createdAt);
		return `• ${item.title}${detail} · ${date}\n  ${new URL(`/posts/${item.id}`, `${appOrigin}/`)}`;
	})].join("\n");
}

function digestSectionHtml(title: string, items: WeeklyDigestItem[], appOrigin: string, useEventDate = false) {
	const safeTitle = escapeHtml(title);
	if (items.length === 0) return `<h2 style="margin:24px 0 8px;font-family:Georgia,serif;font-size:20px">${safeTitle}</h2><p style="margin:0;color:#69636f">Nothing new to share this week.</p>`;
	return [
		`<h2 style="margin:24px 0 8px;font-family:Georgia,serif;font-size:20px">${safeTitle}</h2>`,
		'<div style="border-top:1px solid #eee7da">',
		...items.map((item) => {
			const link = escapeHtml(new URL(`/posts/${item.id}`, `${appOrigin}/`).toString());
			const detail = item.organizationName ? ` &middot; ${escapeHtml(item.organizationName)}` : "";
			const date = escapeHtml(formatEmailDate(useEventDate && item.eventStartsAt ? item.eventStartsAt : item.createdAt));
			return `<div style="padding:12px 0;border-bottom:1px solid #eee7da"><a href="${link}" style="color:#44275f;font-weight:700;text-decoration:none">${escapeHtml(item.title)}</a><p style="margin:3px 0 0;color:#69636f;font-size:13px">${date}${detail}</p></div>`;
		}),
		"</div>",
	].join("");
}

export function createWeeklyDigestEmailContent(input: {
	recipientName: string | null;
	appOrigin: string;
	updates: WeeklyDigestItem[];
	projects: WeeklyDigestItem[];
	events: WeeklyDigestItem[];
}) {
	const origin = input.appOrigin.replace(/\/$/, "");
	const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hello,";
	const homeLink = `${origin}/home`;
	const preferencesLink = `${origin}/profile`;
	return {
		subject: "Your weekly NH Connect community update",
		text: [
			greeting,
			"",
			"Here is your weekly look at the NH Connect activity available to you.",
			"",
			digestSectionText("Community updates", input.updates, origin),
			"",
			digestSectionText("Projects", input.projects, origin),
			"",
			digestSectionText("Upcoming events", input.events, origin, true),
			"",
			`Open NH Connect: ${homeLink}`,
			`Manage notification preferences: ${preferencesLink}`,
		].join("\n"),
		html: [
			'<div style="margin:0;padding:30px 18px;background:#fff9ed;color:#211333;font-family:Arial,Helvetica,sans-serif;line-height:1.55">',
			'<div style="max-width:620px;margin:0 auto;overflow:hidden;border:1px solid #dfd7c9;border-radius:16px;background:#fffef8">',
			'<div style="height:7px;background:#754595"></div><div style="padding:28px 30px">',
			'<p style="margin:0 0 8px;color:#9f2d69;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Your weekly digest</p>',
			'<h1 style="margin:0 0 14px;font-family:Georgia,serif;font-size:29px;line-height:1.2">What’s happening on NH Connect</h1>',
			`<p style="margin:0;color:#62566d">${escapeHtml(greeting)} Here is the latest activity available through your community network.</p>`,
			digestSectionHtml("Community updates", input.updates, origin),
			digestSectionHtml("Projects", input.projects, origin),
			digestSectionHtml("Upcoming events", input.events, origin, true),
			`<p style="margin:26px 0 0"><a href="${escapeHtml(homeLink)}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#5b3178;color:#fff;font-weight:700;text-decoration:none">Open NH Connect</a></p>`,
			`<p style="margin:22px 0 0;color:#69636f;font-size:12px">This digest only includes content you can access. Change your email settings in <a href="${escapeHtml(preferencesLink)}" style="color:#5b3178">notification preferences</a>.</p>`,
			'</div><div style="padding:16px 30px;border-top:1px solid #eee7da;background:#f7effa;color:#62566d;font-size:12px">NH Connect &middot; A Queerlective initiative</div></div></div>',
		].join(""),
	};
}

export async function sendWeeklyDigestEmail(env: Env, input: {
	to: string;
	recipientName: string | null;
	updates: WeeklyDigestItem[];
	projects: WeeklyDigestItem[];
	events: WeeklyDigestItem[];
}) {
	const content = createWeeklyDigestEmailContent({ ...input, appOrigin: env.APP_ORIGIN });
	return env.EMAIL.send({
		to: input.to,
		from: { email: env.EMAIL_FROM, name: SENDER_NAME },
		subject: content.subject,
		text: content.text,
		html: content.html,
	});
}
