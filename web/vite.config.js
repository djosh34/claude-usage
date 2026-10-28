import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: adapter(),
			output: { bundleStrategy: 'inline' },
			// Published by host-plan at /claude-usage/mockup/
			paths: { base: '/claude-usage/mockup', relative: true }
		})
	]
});
