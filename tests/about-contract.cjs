const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifest = require('./about-manifest.json');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
test('original descriptions, credits, project links and structured data survive', () => {
  const old = manifest.originalAbout;
  for (const match of old.matchAll(/<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)>/g)) {
    if (match[1] === '<strong>More from Tront</strong>') continue;
    assert.ok(html.includes(match[1]), 'Lost original content: ' + match[1]);
  }
  assert.ok(html.includes(manifest.originalJsonLd));
});
test('approved shared source is pinned byte for byte', () => {
  for (const [file, hash] of Object.entries(manifest.assets)) {
    const bytes = fs.readFileSync(path.join(root,file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), hash);
  }
  assert.equal(manifest.upstreamCommit, '83dbfb4d8241501012c5ec22be49d79f28ccf6b7');
});
test('one collapsed host, local assets, early scoped input integration', () => {
  assert.equal((html.match(/data-tront-discovery data-current-game/g)||[]).length,1);
  assert.match(html, /<details class="tront-about" id="trontAbout" style=/);
  assert.ok(html.indexOf('tront-about-shell.js') < html.indexOf('</head>'));
  assert.ok(!html.includes('<details class="tront-about" id="trontAbout" open'));
  const block = html.match(/<!-- tront-about:start -->[\s\S]*?<!-- tront-about:end -->/)[0];
  assert.doesNotMatch(block, /\.mp4|<video/);
  assert.doesNotMatch(block, /data-tront-discovery-status/);
  assert.match(html, /data-tront-discovery-game-surface/);
});
