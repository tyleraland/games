import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import glsl from 'vite-plugin-glsl';

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), glsl()],
	base: process.env.GH_PAGES ? '/r3f-vite-starter/' : '/',
});
