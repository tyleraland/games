// Registry of playable games shown on the landing page. Add an entry here (and
// a matching <Route>) to list a new game.
export interface GameEntry {
	slug: string;
	title: string;
	description: string;
	// Emoji used as a simple thumbnail on the landing card.
	icon: string;
}

export const GAMES: GameEntry[] = [
	{
		slug: 'slingshot',
		title: '3D Slingshot',
		description:
			'Aim angle and power to arc a ball into a brick pyramid and knock it down.',
		icon: '🎯',
	},
];
