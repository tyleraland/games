import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import glsl from 'vite-plugin-glsl';
import { execSync } from 'node:child_process';

// Collect git info at build time so the landing page can show which build is
// live and its recent history. CI must check out enough history (fetch-depth 0)
// for the commit list to be complete; falls back gracefully if git is absent.
function gitInfo() {
	const run = (cmd: string) => execSync(cmd).toString().trim();
	try {
		const sha = run('git rev-parse HEAD');
		const shortSha = run('git rev-parse --short HEAD');
		// Unit-separator-delimited fields, one commit per line.
		const raw = run(
			'git log -5 --pretty=format:%h%x1f%s%x1f%an%x1f%ad --date=short',
		);
		const commits = raw
			.split('\n')
			.filter(Boolean)
			.map((line) => {
				const [hash, subject, author, date] = line.split('\x1f');
				return { hash, subject, author, date };
			});
		return { sha, shortSha, commits };
	} catch {
		return { sha: 'unknown', shortSha: 'unknown', commits: [] };
	}
}

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), glsl()],
	// On GitHub Pages the app is served from https://<user>.github.io/games/,
	// so assets must be requested under /games/. Locally the base stays '/'.
	base: process.env.GH_PAGES ? '/games/' : '/',
	define: {
		__GIT_INFO__: JSON.stringify(gitInfo()),
	},
});
