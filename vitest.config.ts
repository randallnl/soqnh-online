import {
	cloudflareTest,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
	plugins: [
		cloudflareTest({
			main: "./test/worker.ts",
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				bindings: { TEST_MIGRATIONS: migrations },
				serviceBindings: {
					EVENT_SCRAPER() {
						return Response.json({
							partners: 0,
							scraped: 0,
							submitted: 0,
							imported: 0,
							updated: 0,
							skipped: 0,
							failures: [],
						});
					},
				},
			},
		}),
	],
});
