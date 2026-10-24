import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

export async function buildOffline() {
  const result = await build({
    entryPoints: ['src/main.js'],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2020'],
    write: false
  });
  const [template, css] = await Promise.all([
    readFile('src/template.html', 'utf8'),
    readFile('src/styles.css', 'utf8')
  ]);
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = template
    .replace('/* INLINE_CSS */', () => css)
    .replace('/* INLINE_JS */', () => js);
  await writeFile('index.html', html);
}

await buildOffline();
