const mediaPrefixes = ["profile-photos/", "org-logos/"] as const;

export function mediaUrl(objectKey: string | null | undefined) {
	if (!objectKey || !mediaPrefixes.some((prefix) => objectKey.startsWith(prefix))) return null;
	return `/media/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
}

export function initials(name: string | null | undefined, fallback = "Member") {
	return (name?.trim() || fallback)
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("");
}
