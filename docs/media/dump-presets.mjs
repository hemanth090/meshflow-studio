#!/usr/bin/env node
/**
 * dump-presets.mjs - export the plugin's REAL preset compositions to `presets.json`.
 *
 * The video generator must not invent colours or blob positions: it reads the exact
 * `MF.model.PRESETS` data the studio ships with. This script loads the plain-script
 * fragments (`src/00-prelude.js` + `src/10-model.js`) in a `node:vm` sandbox exactly
 * like `test/model.test.mjs` does, then prints the normalised preset list.
 *
 *   node docs/media/dump-presets.mjs          # writes docs/media/presets.json
 *   node docs/media/dump-presets.mjs --stdout # print without writing
 *
 * No npm dependencies, no network, read-only with respect to the plugin sources.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, '..', '..');
const preludeSource = readFileSync(join(pluginRoot, 'src', '00-prelude.js'), 'utf8');
const modelSource = readFileSync(join(pluginRoot, 'src', '10-model.js'), 'utf8');

const sandbox = {};
const context = vm.createContext(sandbox);
vm.runInContext(preludeSource, context, { filename: '00-prelude.js' });
vm.runInContext(modelSource, context, { filename: '10-model.js' });
// `const MF` in the prelude is script-scoped; hand it to the sandbox explicitly.
vm.runInContext('globalThis.MF = MF;', context, { filename: 'expose-mf.js' });

const MF = sandbox.MF;
if (!MF || !MF.model || !Array.isArray(MF.model.PRESETS)) {
  throw new Error('MF.model.PRESETS missing - cannot dump presets');
}

/** vm objects live in another realm; JSON round-trip yields plain host objects. */
const plain = (value) => JSON.parse(JSON.stringify(value));

const presets = MF.model.PRESETS.map((preset) => {
  const state = plain(preset.state);
  return {
    id: preset.id,
    nameKey: preset.nameKey,
    tagKey: preset.tagKey,
    name: state.name,
    // The exact, normalised composition the studio applies when this preset is clicked.
    state,
  };
});

const payload = {
  format: 'meshflow-studio-presets-dump',
  version: 1,
  source: 'src/00-prelude.js + src/10-model.js (MF.model.PRESETS via node:vm)',
  plugin: { id: MF.ID, version: MF.VERSION, modelVersion: MF.model.VERSION },
  palette: plain(MF.model.PALETTES),
  presets,
};

const json = JSON.stringify(payload, null, 2) + '\n';

if (process.argv.includes('--stdout')) {
  process.stdout.write(json);
} else {
  const out = join(here, 'presets.json');
  writeFileSync(out, json, 'utf8');
  process.stderr.write(
    `wrote ${out} - ${presets.length} presets, ${Buffer.byteLength(json)} bytes\n`,
  );
}
