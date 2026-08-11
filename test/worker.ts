export default {
	async fetch() {
		return new Response("Test Worker");
	},
} satisfies ExportedHandler<Env>;
