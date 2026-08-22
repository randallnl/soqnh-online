import { initials, mediaUrl } from "~/lib/media";

export function IdentityAvatar({
	name,
	objectKey,
	size = "regular",
	className = "",
}: {
	name: string | null;
	objectKey?: string | null;
	size?: "regular" | "large";
	className?: string;
}) {
	const src = mediaUrl(objectKey);
	const classes = `avatar identity-avatar${size === "large" ? " identity-avatar--large" : ""}${className ? ` ${className}` : ""}`;
	return src
		? <span className={classes}><img alt="" loading="lazy" src={src} /></span>
		: <span className={classes}>{initials(name)}</span>;
}

export function OrganizationIdentity({
	name,
	logoObjectKey,
	large = false,
}: {
	name: string;
	logoObjectKey?: string | null;
	large?: boolean;
}) {
	const src = mediaUrl(logoObjectKey);
	const classes = `organization-monogram${large ? " organization-monogram--large" : ""}`;
	return src
		? <span className={`${classes} organization-logo`}><img alt="" loading="lazy" src={src} /></span>
		: <span className={classes}>{initials(name, "Organization")}</span>;
}
