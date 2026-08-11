export function requireSameOrigin(request: Request) {
	const origin = request.headers.get("Origin");
	const requestUrl = new URL(request.url);

	if (!origin || origin !== requestUrl.origin) {
		throw new Response("Invalid request origin", { status: 403 });
	}
}
