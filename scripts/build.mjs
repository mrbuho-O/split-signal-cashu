import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const stylesheet = await readFile(new URL('src/style.css', root), 'utf8');
const template = await readFile(new URL('src/index.html', root), 'utf8');
const { outputFiles } = await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ['src/app.js'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'inline',
});
const source = outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const licensePaths = {
  'Split Signal': 'LICENSE',
  '@scure/base': 'node_modules/@scure/base/LICENSE',
  cborg: 'node_modules/cborg/LICENSE',
  qrcode: 'node_modules/qrcode/license',
  dijkstrajs: 'node_modules/dijkstrajs/LICENSE.md',
};
const licenses = (await Promise.all(Object.entries(licensePaths).map(async ([name, file]) => (
  `${name}\n${await readFile(new URL(file, root), 'utf8')}`
)))).join('\n\n');
const out = template.replace('/* CSS */', () => stylesheet)
  .replace('/* JAVASCRIPT */', () => source)
  .replace('/* LICENSES */', () => licenses.replace(/<\/script/gi, '<\\/script'));
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/index.html', root), out);
