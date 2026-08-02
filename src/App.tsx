import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Landing from './routes/Landing';
import SlingshotGame from './routes/SlingshotGame';
import FlowyGame from './routes/FlowyGame';

// HashRouter keeps deep links working on GitHub Pages (a static host) without
// server-side rewrite rules — routes live after the URL hash.
function App() {
	return (
		<HashRouter>
			<Routes>
				<Route path="/" element={<Landing />} />
				<Route path="/slingshot" element={<SlingshotGame />} />
				<Route path="/flowy" element={<FlowyGame />} />
				{/* Unknown paths fall back to the landing page. */}
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</HashRouter>
	);
}

export default App;
