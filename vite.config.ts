import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import glsl from 'vite-plugin-glsl';

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), glsl()],
	// On GitHub Pages the app is served from https://<user>.github.io/games/,
	// so assets must be requested under /games/. Locally the base stays '/'.
	base: process.env.GH_PAGES ? '/games/' : '/',
});
