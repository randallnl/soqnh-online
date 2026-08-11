export type AccountStatus = "invited" | "active" | "suspended";
export type OrganizationRole = "org_admin" | "contributor" | "viewer";
export type SiteRole = "member" | "site_admin";

export type PermissionContext = {
	accountStatus: AccountStatus;
	siteRole: SiteRole;
	organizationRole?: OrganizationRole;
};

export function canAccessDashboard(context: PermissionContext) {
	return context.accountStatus === "active";
}

export function canCreateContent(context: PermissionContext) {
	if (!canAccessDashboard(context)) return false;
	return (
		context.siteRole === "site_admin" ||
		context.organizationRole === "org_admin" ||
		context.organizationRole === "contributor"
	);
}

export function canManageOrganization(context: PermissionContext) {
	if (!canAccessDashboard(context)) return false;
	return (
		context.siteRole === "site_admin" ||
		context.organizationRole === "org_admin"
	);
}

export function canModerate(context: PermissionContext) {
	return (
		canAccessDashboard(context) &&
		(context.siteRole === "site_admin" ||
			context.organizationRole === "org_admin")
	);
}
