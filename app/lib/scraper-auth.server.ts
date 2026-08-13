import { hashSecret } from "~/lib/auth.server";

export async function requireScraperApiToken(request: Request, env: Env) {
	const authorization = request.headers.get("Authorization") ?? "";
	const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
	if (!supplied || !env.SCRAPER_API_TOKEN) {
		throw new Response("Unauthorized", { status: 401 });
	}
	const [suppliedHash, expectedHash] = await Promise.all([
		hashSecret(supplied),
		hashSecret(env.SCRAPER_API_TOKEN),
	]);
	const encoder = new TextEncoder();
	const subtle = crypto.subtle as SubtleCrypto & {
		timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
	};
	if (!subtle.timingSafeEqual(encoder.encode(suppliedHash), encoder.encode(expectedHash))) {
		throw new Response("Unauthorized", { status: 401 });
	}
}

export async function readBoundedJson(request: Request, maximumBytes: number) {
	const contentLength = Number(request.headers.get("Content-Length") ?? "0");
	if (contentLength > maximumBytes) {
		throw new Response("Request body too large", { status: 413 });
	}
	if (!request.body) return null;
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		length += value.byteLength;
		if (length > maximumBytes) {
			await reader.cancel();
			throw new Response("Request body too large", { status: 413 });
		}
		chunks.push(value);
	}
	const body = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder().decode(body)) as unknown;
	} catch {
		throw new Response("Invalid JSON", { status: 400 });
	}
}
