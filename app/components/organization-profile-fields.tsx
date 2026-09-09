import type { OrganizationRecord } from "~/models/organizations.server";
import { organizationCategoryOptions, organizationCategoryTone, parseOrganizationCategories } from "~/lib/organization-categories";

const regionOptions = [
	"Great North Woods",
	"White Mountains",
	"Lakes Region",
	"Dartmouth-Lake Sunapee Region",
	"Monadnock Region",
	"Merrimack Valley",
	"Seacoast",
	"North Country",
	"Statewide",
	"National",
] as const;

const socialPlatformOptions = [
	"Instagram",
	"Facebook",
	"TikTok",
	"LinkedIn",
	"YouTube",
	"Bluesky",
	"Threads",
	"X",
	"Other",
] as const;

function ProfileSelect({
	label,
	name,
	value,
	options,
}: {
	label: string;
	name: string;
	value: string | null | undefined;
	options: readonly string[];
}) {
	const currentValue = value?.trim() ?? "";
	const hasLegacyValue = Boolean(currentValue) && !options.includes(currentValue);
	return <label>{label}<select defaultValue={currentValue} name={name}>
		<option value="">Not specified</option>
		{hasLegacyValue && <option value={currentValue}>Current: {currentValue}</option>}
		{options.map((option) => <option key={option} value={option}>{option}</option>)}
	</select></label>;
}

export function OrganizationProfileFields({ organization }: { organization?: Partial<OrganizationRecord> }) {
	const selectedCategories = parseOrganizationCategories(organization?.category);
	const categoryOptions = [...new Set([...organizationCategoryOptions, ...selectedCategories])];
	return <>
		<label>Name<input defaultValue={organization?.name ?? ""} maxLength={120} name="name" placeholder="Organization name" required /></label>
		<fieldset className="organization-category-picker wide-field">
			<legend>Categories</legend>
			<p>Select all that apply.</p>
			<div className="organization-category-options">
				{categoryOptions.map((category) => (
					<label className={`organization-category-option organization-category-tone--${organizationCategoryTone(category)}`} key={category}>
						<input defaultChecked={selectedCategories.includes(category)} name="category" type="checkbox" value={category} />
						<span>{category}</span>
					</label>
				))}
			</div>
		</fieldset>
		<label>Website<input defaultValue={organization?.websiteUrl ?? ""} maxLength={500} name="websiteUrl" placeholder="https://example.org" type="url" /></label>
		<label>Event source URL<input defaultValue={organization?.eventSourceUrl ?? ""} maxLength={500} name="eventSourceUrl" placeholder="https://example.org/events" type="url" /></label>
		<label>Contact email<input defaultValue={organization?.contactEmail ?? ""} maxLength={320} name="contactEmail" placeholder="hello@example.org" type="email" /></label>
		<label>Contact phone<input defaultValue={organization?.contactPhone ?? ""} maxLength={80} name="contactPhone" type="tel" /></label>
		<label>Town or city<input defaultValue={organization?.townCity ?? ""} maxLength={200} name="townCity" /></label>
		<ProfileSelect label="Region" name="region" options={regionOptions} value={organization?.region} />
		<label>Operates or provides services statewide<select defaultValue={organization?.operatesStatewide === 1 ? "yes" : organization?.operatesStatewide === 0 ? "no" : "unknown"} name="operatesStatewide"><option value="unknown">Not specified</option><option value="yes">Yes</option><option value="no">No</option></select></label>
		<ProfileSelect label="Primary social media" name="socialPlatform" options={socialPlatformOptions} value={organization?.socialPlatform} />
		<label>Primary social media handle<input defaultValue={organization?.socialHandle ?? ""} maxLength={200} name="socialHandle" placeholder="@organization" /></label>
		<label className="wide-field">Short summary<input defaultValue={organization?.summary ?? ""} maxLength={240} name="summary" placeholder="A short description for organization cards" /></label>
		<label className="wide-field">Description<textarea defaultValue={organization?.description ?? ""} maxLength={4000} name="description" rows={5} /></label>
		<label className="wide-field">Why should this listing be included?<textarea defaultValue={organization?.listingRationale ?? ""} maxLength={2000} name="listingRationale" rows={3} /></label>
		<label>Is this organization queer and/or BIPOC-led?<input defaultValue={organization?.leadershipIdentity ?? ""} maxLength={100} name="leadershipIdentity" placeholder="Yes, queer-led; yes, BIPOC-led…" /></label>
		<label className="wide-field">Logo or photo links<textarea defaultValue={organization?.sourceImageUrls ?? ""} maxLength={4000} name="sourceImageUrls" placeholder="One source image URL per line" rows={3} /></label>
	</>;
}
