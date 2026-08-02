// Builds Flowy into a single self-contained HTML file with no external
// requests, suitable for hosting anywhere static (or publishing as an
// Artifact, where a strict CSP blocks every external host).
//
// Vite emits flowy.html plus a JS and a CSS asset; this inlines both and
// writes the result as page content only — no <html>/<head>/<body> wrapper —
// because the Artifact host supplies its own document skeleton.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-flowy');

execFileSync('npx', ['vite', 'build', '--config', 'vite.standalone.config.ts'], {
	cwd: root,
	stdio: 'inherit',
});

const assets = readdirSync(join(outDir, 'assets'));
const jsName = assets.find((f) => f.endsWith('.js'));
const cssName = assets.find((f) => f.endsWith('.css'));
if (!jsName) throw new Error('no JS asset emitted');

const js = readFileSync(join(outDir, 'assets', jsName), 'utf8');
const css = cssName ? readFileSync(join(outDir, 'assets', cssName), 'utf8') : '';

// A closing </script> anywhere inside the bundle would end the inline block
// early; the escape is invisible to the JS parser.
const safeJs = js.replaceAll('</script', '<\\/script');

const page = `<title>Flowy</title>
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${safeJs}
</script>
`;

const target = join(root, 'dist-flowy', 'flowy-standalone.html');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, page);
console.log(
	`wrote ${target} (${(Buffer.byteLength(page) / 1024).toFixed(0)} KB)`,
);
