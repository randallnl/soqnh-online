const mediaPrefixes = ["profile-photos/", "org-logos/", "content-images/"] as const;

export const imageUploadAccept = "image/png,image/jpeg,image/webp,image/gif";

export type ContentImageAttachment = {
	id: string;
	objectKey: string;
	filename: string;
	contentType: string;
	byteSize: number;
};

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
