export const organizationStatuses = ["active", "inactive", "archived"] as const;
export const organizationRoles = ["viewer", "contributor", "org_admin"] as const;

export type OrganizationStatus = (typeof organizationStatuses)[number];
export type OrganizationRole = (typeof organizationRoles)[number];

export function slugifyOrganizationName(value: string) {
	return value
		.trim()
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}
