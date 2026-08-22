const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const extensions = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
} as const;

export class ImageUploadError extends Error {
	constructor(public readonly reason: "too-large" | "unsupported" | "invalid") {
		super(reason);
		this.name = "ImageUploadError";
	}
}

export function requireUploadRequestSize(request: Request) {
	const contentLength = Number(request.headers.get("Content-Length") ?? "0");
	if (contentLength > MAX_IMAGE_BYTES + 256 * 1024) {
		throw new ImageUploadError("too-large");
	}
}

function matchesSignature(bytes: Uint8Array, type: keyof typeof extensions) {
	if (type === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
	if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	if (type === "image/gif") return bytes.length >= 6 && new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/) !== null;
	return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}

export async function uploadIdentityImage(
	env: Env,
	file: FormDataEntryValue | null,
	kind: "profile-photos" | "org-logos",
	ownerId: string,
) {
	if (!(file instanceof File) || file.size === 0) return null;
	if (file.size > MAX_IMAGE_BYTES) throw new ImageUploadError("too-large");
	if (!(file.type in extensions)) throw new ImageUploadError("unsupported");
	const type = file.type as keyof typeof extensions;
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (!matchesSignature(bytes, type)) throw new ImageUploadError("invalid");
	const key = `${kind}/${ownerId}-${crypto.randomUUID()}.${extensions[type]}`;
	await env.ASSETS.put(key, bytes, {
		httpMetadata: { contentType: type, cacheControl: "private, max-age=3600" },
		customMetadata: { ownerId, kind },
	});
	return key;
}

export async function deleteIdentityImage(env: Env, objectKey: string | null) {
	if (!objectKey || (!objectKey.startsWith("profile-photos/") && !objectKey.startsWith("org-logos/"))) return;
	await env.ASSETS.delete(objectKey);
}
