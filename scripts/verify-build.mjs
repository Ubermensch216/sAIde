import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const dir = '.output/chrome-mv3';
const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.minimum_chrome_version, '116');
assert.equal(manifest.default_locale, 'ko');
assert.ok(!manifest.content_scripts?.length, 'Content scripts must remain on-demand');
assert.deepEqual(manifest.host_permissions, ['http://localhost:11434/*', 'http://127.0.0.1:11434/*']);
for (const file of [manifest.background.service_worker, manifest.side_panel.default_path, manifest.options_ui.page, 'injected.js', ...Object.values(manifest.icons)]) {
  assert.ok(existsSync(`${dir}/${file}`), `Missing build artifact: ${file}`);
}
console.log('MV3 manifest and referenced build artifacts verified.');
