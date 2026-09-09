import { Link } from "react-router";

import type { Route } from "./+types/how-to-use";
import { Icon } from "~/components/icon";
import { requireAuthenticatedUser } from "~/lib/auth.server";

export function meta() {
	return [
		{ title: "How to use this site · NH Connect" },
		{ name: "description", content: "A practical guide to participating in the NH Connect member network." },
	];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	return { isSiteAdmin: user.siteRole === "site_admin" };
}

const quickStart = [
	{ title: "Complete your profile", body: "Add the name, role, pronouns, location, and bio you want other signed-in members to see.", to: "/profile", action: "Edit your profile" },
	{ title: "Connect to your organizations", body: "Claim the organizations you work with and choose your role. An administrator reviews the request before access changes.", to: "/profile", action: "Request a role" },
	{ title: "Request affiliation access", body: "Affiliations are coalition-specific spaces. Request access from your profile; a site administrator must approve it.", to: "/profile", action: "View affiliations" },
	{ title: "Join the conversation", body: "Share a Community Feed update, find a project, or add an event for the ecosystem.", to: "/updates", action: "Open Community Feed" },
];

export default function HowToUse({ loaderData }: Route.ComponentProps) {
	return <div className="guide-page">
		<section className="page-heading guide-heading">
			<div><p className="eyebrow">Member guide</p><h1>How to use this site</h1><p>NH Connect is a private, invitation-only workspace for sharing community updates, coordinating projects, finding organizations and people, and keeping events visible across the state.</p></div>
		</section>

		<div className="guide-layout">
			<aside className="panel guide-index" aria-label="On this page">
				<strong>On this page</strong>
				<nav>
					<a href="#start">Start here</a>
					<a href="#audiences">Who can see what</a>
					<a href="#sharing">Ways to share</a>
					<a href="#organizations">Organizations</a>
					<a href="#affiliations">Affiliations</a>
					<a href="#privacy">Privacy and visibility</a>
					<a href="#approvals">What needs approval</a>
					{loaderData.isSiteAdmin && <a href="#administration">For site administrators</a>}
				</nav>
			</aside>

			<div className="guide-content">
				<section className="guide-section" id="start">
					<div className="guide-section-heading"><span>01</span><div><p className="eyebrow">Start here</p><h2>Get set up in four steps</h2></div></div>
					<div className="guide-quick-grid">{quickStart.map((item, index) => <article className="panel guide-quick-card" key={item.title}><span>{index + 1}</span><h3>{item.title}</h3><p>{item.body}</p><Link to={item.to}>{item.action} <Icon name="chevron-right" size={15} /></Link></article>)}</div>
				</section>

				<section className="guide-section" id="audiences">
					<div className="guide-section-heading"><span>02</span><div><p className="eyebrow">Audience controls</p><h2>Choose who should see your work</h2></div></div>
					<div className="guide-audience-grid">
						<article><strong>Ecosystem-wide</strong><p>Visible to every signed-in member. This is the default for Community Feed updates, manually added events, and automatically synced events.</p></article>
						<article><strong>Affiliation</strong><p>Visible only to members with approved access to the selected coalition or affiliation. You only see affiliation filters and posting options you can use.</p></article>
						<article><strong>Organization-only</strong><p>Available for projects that should stay among the direct members of one organization.</p></article>
					</div>
					<p className="guide-note"><Icon name="people" size={18} /><span>Choosing <strong>Ecosystem-wide</strong> clears affiliation selections. Choosing an affiliation makes the audience narrower.</span></p>
				</section>

				<section className="guide-section" id="sharing">
					<div className="guide-section-heading"><span>03</span><div><p className="eyebrow">Participate</p><h2>Three ways to share</h2></div></div>
					<div className="guide-card-grid">
						<article className="panel guide-feature-card"><span className="guide-feature-icon"><Icon name="message" /></span><div><h3>Community Feed</h3><p>Use this for informal updates, questions, resources, requests, and wins. Posts do not need titles. Members can support and comment directly from the feed.</p><ul><li>Post as yourself or an organization you represent.</li><li>Use <strong>@</strong> to mention a person or organization.</li><li>Add an optional image up to 10 MB.</li></ul><Link to="/updates">Open Community Feed</Link></div></article>
						<article className="panel guide-feature-card"><span className="guide-feature-icon"><Icon name="clipboard" /></span><div><h3>Projects</h3><p>Use projects for sustained work, initiatives, and collaboration opportunities that need more structure than a feed update.</p><ul><li>Add a title, description, topic tags, and optional image.</li><li>Save a draft or publish when ready.</li><li>Share ecosystem-wide, with affiliations, or only within an organization.</li></ul><Link to="/projects">Browse projects</Link></div></article>
						<article className="panel guide-feature-card"><span className="guide-feature-icon"><Icon name="calendar" /></span><div><h3>Events</h3><p>Add events manually or place an events-page URL on your organization profile for automatic syncing.</p><ul><li>Include dates, location, registration, and source links.</li><li>Events go through moderation before publication.</li><li>Use an affiliation only when the event is intended for that group.</li></ul><Link to="/events">View events</Link></div></article>
					</div>
					<div className="guide-tags-note"><div><strong># Topic tags</strong><p>Help people find related posts such as #mutual-aid or #policy.</p></div><div><strong>@ Mentions</strong><p>Link a person or organization inline. Mentioned people receive a notification.</p></div></div>
				</section>

				<section className="guide-section" id="organizations">
					<div className="guide-section-heading"><span>04</span><div><p className="eyebrow">Organizations</p><h2>Find groups and represent your work</h2></div></div>
					<p>Every signed-in member can browse the organization directory. From your profile, you can claim an organization and request the role that matches your participation. Contributors can publish on an organization’s behalf; organization administrators can also manage its profile and member access.</p>
					<div className="guide-action-row"><Link className="button button--secondary" to="/organizations"><Icon name="building" size={17} /> Browse organizations</Link><Link className="button button--secondary" to="/profile"><Icon name="user" size={17} /> Request an organization role</Link></div>
					<p className="guide-note"><Icon name="sparkles" size={18} /><span>An organization administrator can opt into the <strong>NH Connect public directory</strong>. The organization profile explains what information becomes public before opt-in.</span></p>
				</section>

				<section className="guide-section" id="affiliations">
					<div className="guide-section-heading"><span>05</span><div><p className="eyebrow">Affiliations</p><h2>Work within coalition spaces</h2></div></div>
					<p>Affiliations are narrower networks or coalitions inside the broader ecosystem. Members cannot add themselves. Request affiliation access from your profile, then wait for a site administrator to approve or reject it. You may cancel a pending request at any time.</p>
					<p>Once approved, that affiliation becomes available when you post or filter content. You may also receive affiliation access through an organization’s membership in that coalition.</p>
					<Link className="button button--primary" to="/profile">View or request affiliations</Link>
				</section>

				<section className="guide-section" id="privacy">
					<div className="guide-section-heading"><span>06</span><div><p className="eyebrow">Privacy</p><h2>What other people can see</h2></div></div>
					<div className="guide-privacy-list">
						<article><Icon name="user" size={19} /><div><strong>Your member profile</strong><p>Visible to signed-in members unless you set directory visibility to hidden. Your own affiliations remain visible to you and site administrators.</p></div></article>
						<article><Icon name="building" size={19} /><div><strong>Organization directory</strong><p>Available to all signed-in members. Affiliation labels and filters are only shown where the viewer has access.</p></div></article>
						<article><Icon name="people" size={19} /><div><strong>Affiliation activity</strong><p>Posts, projects, events, and filters for an affiliation are limited to members with effective access to that affiliation.</p></div></article>
					</div>
				</section>

				<section className="guide-section" id="approvals">
					<div className="guide-section-heading"><span>07</span><div><p className="eyebrow">Moderation</p><h2>What needs approval</h2></div></div>
					<div className="guide-approval-grid"><article><strong>Organization roles</strong><p>Reviewed by a site administrator or an administrator for that organization.</p></article><article><strong>Affiliation access</strong><p>Reviewed by a site administrator.</p></article><article><strong>Events</strong><p>Reviewed by an eligible moderator before members can see them. Editing an approved event sends it back for review.</p></article><article><strong>Public directory opt-in</strong><p>Reviewed before an organization is added to the NH Connect public directory.</p></article></div>
				</section>

				{loaderData.isSiteAdmin && <section className="guide-section guide-admin-section" id="administration">
					<div className="guide-section-heading"><span>08</span><div><p className="eyebrow">Site administrators</p><h2>Keep the network moving</h2></div></div>
					<p>The administration area brings together member access, invitations, organization review, affiliation requests, event scraping, and the audit log. Pending affiliation requests are reviewed on the Affiliations page.</p>
					<div className="guide-action-row"><Link className="button button--primary" to="/admin">Open admin overview</Link><Link className="button button--secondary" to="/admin/affiliations">Review affiliation requests</Link></div>
				</section>}
			</div>
		</div>
	</div>;
}
