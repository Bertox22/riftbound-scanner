// Que la app se cargue entera: cada módulo de web/js tiene que estar en el importmap de index.html con la
// versión de ahora (si falta, el móvil puede mezclar un módulo nuevo con otros viejos de la caché).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const web = new URL('../web/', import.meta.url);
const html = readFileSync(new URL('index.html', web), 'utf8');
const version = html.match(/styles\.css\?v=(\d+)/)[1];
const modules = readdirSync(new URL('js/', web)).filter((f) => f.endsWith('.js') && f !== 'app.js');
const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;

test('cada módulo está en el importmap con la versión actual', () => {
  for (const f of modules) assert.equal(map[`./js/${f}`], `./js/${f}?v=${version}`, `${f} en el importmap de index.html`);
  assert.ok(html.includes(`js/app.js?v=${version}`), 'app.js con la versión actual');
});

test('el importmap no apunta a módulos que ya no existen', () => {
  for (const key of Object.keys(map)) assert.ok(modules.includes(key.replace('./js/', '')), `${key} no existe en web/js`);
});

test('los módulos solo importan archivos que existen', () => {
  for (const f of [...modules, 'app.js']) {
    const src = readFileSync(new URL(`js/${f}`, web), 'utf8');
    for (const [, dep] of src.matchAll(/^import\s[^'"]*['"]\.\/([^'"]+)['"]/gm)) {
      assert.ok(modules.includes(dep), `${f} importa ./${dep}, que no existe`);
    }
  }
});
