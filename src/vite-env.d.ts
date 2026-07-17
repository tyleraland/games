/// <reference types="vite/client" />

// Injected at build time by vite.config.ts (see `define`).
interface GitCommit {
	hash: string;
	subject: string;
	author: string;
	date: string;
}
interface GitInfo {
	sha: string;
	shortSha: string;
	commits: GitCommit[];
}
declare const __GIT_INFO__: GitInfo;
