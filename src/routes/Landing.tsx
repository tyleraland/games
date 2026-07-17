import { Link } from 'react-router-dom';
import { GAMES } from '../games';

// Build info baked in at build time (see vite.config.ts).
const GIT = __GIT_INFO__;

// Landing page: a header, the list of games, and a build-info footer showing
// the deployed commit SHA and the last few commits.
export default function Landing() {
	return (
		<div className="landing">
			<header className="landing-header">
				<h1>Games</h1>
				<p className="landing-tagline">
					A small collection of browser games. Pick one to play.
				</p>
			</header>

			<ul className="game-list">
				{GAMES.map((game) => (
					<li key={game.slug}>
						<Link className="game-card" to={`/${game.slug}`}>
							<span className="game-icon" aria-hidden="true">
								{game.icon}
							</span>
							<span className="game-text">
								<span className="game-title">{game.title}</span>
								<span className="game-desc">{game.description}</span>
							</span>
							<span className="game-arrow" aria-hidden="true">
								→
							</span>
						</Link>
					</li>
				))}
			</ul>

			<footer className="build-info">
				<div className="build-sha">
					<span className="build-label">Build</span>
					<code>{GIT.shortSha}</code>
				</div>
				{GIT.commits.length > 0 && (
					<ol className="commit-list">
						{GIT.commits.map((c) => (
							<li key={c.hash} className="commit">
								<code className="commit-hash">{c.hash}</code>
								<span className="commit-subject">{c.subject}</span>
								<span className="commit-meta">
									{c.author} · {c.date}
								</span>
							</li>
						))}
					</ol>
				)}
			</footer>
		</div>
	);
}
