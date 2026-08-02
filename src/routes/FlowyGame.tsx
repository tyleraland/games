import { Link } from 'react-router-dom';
import FlowyApp from '../flowy/FlowyApp';

/** The Flowy route: the game plus a link back to the landing page. */
export default function FlowyGame() {
	return (
		<FlowyApp
			corner={
				<Link className="back-link" to="/">
					← All games
				</Link>
			}
		/>
	);
}
