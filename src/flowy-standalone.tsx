// Entry point for the single-file build of Flowy (see vite.standalone.config.ts
// and scripts/build-flowy-standalone.mjs). No router, no landing page — just
// the game, so the whole thing inlines into one self-contained HTML file.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import FlowyApp from './flowy/FlowyApp';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<FlowyApp />
	</StrictMode>,
);
