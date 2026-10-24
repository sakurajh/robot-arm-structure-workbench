import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('index.html is a self-contained application shell', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['viewport', 'assembly-tree', 'part-details', 'mode-controls', 'reset-view', 'webgl-error']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:/i);
  assert.doesNotMatch(html, /\/\* INLINE_(?:CSS|JS) \*\//);
});
