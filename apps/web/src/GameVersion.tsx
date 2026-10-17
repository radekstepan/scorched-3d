// Replaced by Vite from the official Changesets release plan for this build.
declare const __APP_BUILD_VERSION__: string;

export const BUILD_VERSION = __APP_BUILD_VERSION__;

export default function GameVersion() {
  return <span className="game-version" aria-label={`Game version ${BUILD_VERSION}`} title="Current game build version">v{BUILD_VERSION}</span>;
}
