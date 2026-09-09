import type { OrganizationRecord } from "~/models/organizations.server";
import type { MemberDirectoryRecord } from "~/models/profiles.server";
import { parseOrganizationCategories } from "./organization-categories";

export type OrganizationDirectoryFilters = {
	query: string;
	category: string;
	region: string;
	affiliationId: string;
};

export type MemberDirectoryFilters = {
	query: string;
	organizationId: string;
	location: string;
};

export function directoryFilterValue(value: string | null, maximum = 120) {
	return (value ?? "").trim().slice(0, maximum);
}

export function uniqueDirectoryOptions(values: Array<string | null | undefined>) {
	return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right));
}

export function filterOrganizations(organizations: OrganizationRecord[], filters: OrganizationDirectoryFilters) {
	const query = filters.query.toLocaleLowerCase();
	return organizations.filter((organization) => {
		if (filters.category && !parseOrganizationCategories(organization.category).includes(filters.category)) return false;
		if (filters.region && organization.region !== filters.region) return false;
		if (filters.affiliationId && !organization.affiliations.some((affiliation) => affiliation.id === filters.affiliationId)) return false;
		if (!query) return true;
		return [
			organization.name,
			organization.summary,
			organization.description,
			...parseOrganizationCategories(organization.category),
			organization.townCity,
			organization.region,
			...organization.affiliations.map((affiliation) => affiliation.name),
		].filter(Boolean).join(" ").toLocaleLowerCase().includes(query);
	});
}

export function filterMembers(members: MemberDirectoryRecord[], filters: MemberDirectoryFilters) {
	const query = filters.query.toLocaleLowerCase();
	return members.filter((member) => {
		if (filters.organizationId && !member.organizationIds?.split(",").includes(filters.organizationId)) return false;
		if (filters.location && member.location !== filters.location) return false;
		if (!query) return true;
		return [member.name, member.profileTitle, member.pronouns, member.bio, member.location, member.organizationNames]
			.filter(Boolean).join(" ").toLocaleLowerCase().includes(query);
	});
}
