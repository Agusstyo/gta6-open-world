// Port Marisol — hand-in program for the make.fun "Make GTA 6" bounty (gta6-01).
//
// The game itself lives in game/ as plain static files (index.html plus ES modules and a
// vendored three.js build) and plays offline in a desktop browser. This program's only job
// is the hand-in: copy game/ and screenshots/ from beside this file into the output folder
// and write dossier.json there with buildDossier from the vendored make.fun library, so the
// scorer can rebuild the same dossier from the same files and compare them byte for byte.
//
// Run it the way the grader does, with MAKEFUN_OUTPUT_DIR standing in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The game folder goes over whole; the screenshots folder is created first so an entry
// with its screens already in place copies cleanly either way.
mkdirSync(outputDir, { recursive: true });
cpSync(join(repoDir, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoDir, 'screenshots'))) {
  cpSync(join(repoDir, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

// The caps below are the sealed gate's own numbers (reference/gate.json): the dossier text
// cap shapes the bytes buildDossier writes, and the rest restate the limits the scorer
// enforces, so this program never writes an output the gate would refuse on size alone.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
