import { createRequestHandler } from "react-router";
import { sendWeeklyDigestEmails } from "../app/lib/notification-email.server";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

export default {
	fetch(request, env, ctx) {
		return requestHandler(request, {
			cloudflare: { env, ctx },
		});
	},
	scheduled(controller, env, ctx) {
		ctx.waitUntil(sendWeeklyDigestEmails(env, new Date(controller.scheduledTime)));
	},
} satisfies ExportedHandler<Env>;
