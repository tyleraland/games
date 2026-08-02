import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// Builds Flowy on its own, with everything in a single chunk so the output can
// be inlined into one self-contained HTML file. Kept separate from the main
// config so the multi-game build and its git-info plugin are untouched.
export default defineConfig({
	plugins: [react()],
	build: {
		outDir: 'dist-flowy',
		emptyOutDir: true,
		rollupOptions: {
			input: 'flowy.html',
			output: {
				// One JS file and one CSS file, so inlining is a simple substitution.
				manualChunks: undefined,
				inlineDynamicImports: true,
			},
		},
	},
});
