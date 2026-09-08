import type { OrganizationRecord } from "~/models/organizations.server";

export function OrganizationProfileFields({ organization }: { organization?: Partial<OrganizationRecord> }) {
	return <>
		<label>Name<input defaultValue={organization?.name ?? ""} maxLength={120} name="name" placeholder="Organization name" required /></label>
		<label>Category<input defaultValue={organization?.category ?? ""} maxLength={600} name="category" placeholder="Community and advocacy, health and wellness…" /></label>
		<label>Website<input defaultValue={organization?.websiteUrl ?? ""} maxLength={500} name="websiteUrl" placeholder="https://example.org" type="url" /></label>
		<label>Contact email<input defaultValue={organization?.contactEmail ?? ""} maxLength={320} name="contactEmail" placeholder="hello@example.org" type="email" /></label>
		<label>Contact phone<input defaultValue={organization?.contactPhone ?? ""} maxLength={80} name="contactPhone" type="tel" /></label>
		<label>Town or city<input defaultValue={organization?.townCity ?? ""} maxLength={200} name="townCity" /></label>
		<label>Region<input defaultValue={organization?.region ?? ""} maxLength={120} name="region" /></label>
		<label>Operates or provides services statewide<select defaultValue={organization?.operatesStatewide === 1 ? "yes" : organization?.operatesStatewide === 0 ? "no" : "unknown"} name="operatesStatewide"><option value="unknown">Not specified</option><option value="yes">Yes</option><option value="no">No</option></select></label>
		<label>Primary social media<input defaultValue={organization?.socialPlatform ?? ""} maxLength={80} name="socialPlatform" placeholder="Instagram, Facebook…" /></label>
		<label>Primary social media handle<input defaultValue={organization?.socialHandle ?? ""} maxLength={200} name="socialHandle" placeholder="@organization" /></label>
		<label className="wide-field">Short summary<input defaultValue={organization?.summary ?? ""} maxLength={240} name="summary" placeholder="A short description for organization cards" /></label>
		<label className="wide-field">Description<textarea defaultValue={organization?.description ?? ""} maxLength={4000} name="description" rows={5} /></label>
		<label className="wide-field">Why should this listing be included?<textarea defaultValue={organization?.listingRationale ?? ""} maxLength={2000} name="listingRationale" rows={3} /></label>
		<label>Is this organization queer and/or BIPOC-led?<input defaultValue={organization?.leadershipIdentity ?? ""} maxLength={100} name="leadershipIdentity" placeholder="Yes, queer-led; yes, BIPOC-led…" /></label>
		<label className="wide-field">Logo or photo links<textarea defaultValue={organization?.sourceImageUrls ?? ""} maxLength={4000} name="sourceImageUrls" placeholder="One source image URL per line" rows={3} /></label>
	</>;
}
