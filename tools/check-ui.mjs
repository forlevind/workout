// Сверка UI с ядром: id из разметки vs обращения в src/app.js и импорты из logic.js.
// ponytail: регулярки вместо парсера — разметка и код наши, схемы простые.
// Лежит вне test/, иначе node --test подхватывает файл как тест.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const app = readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const logic = readFileSync(path.join(root, 'src', 'logic.js'), 'utf8');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

// $('x') в app.js — это document.getElementById('x'), поэтому учитываем оба вида.
const usedIds = new Set([
  ...[...app.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ...[...app.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ...[...app.matchAll(/querySelector\(\s*['"]#([A-Za-z][\w-]*)['"]\s*\)/g)].map((m) => m[1]),
]);

const imported = [...app.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/logic\.js['"]/g)]
  .flatMap((block) => block[1].split(','))
  .map((raw) => raw.trim().split(/\s+as\s+/)[0])
  .filter(Boolean);

const exported = new Set([
  ...[...logic.matchAll(/export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  ...[...logic.matchAll(/export\s*\{([^}]+)\}/g)].flatMap((m) =>
    m[1]
      .split(',')
      .map((raw) => raw.trim().split(/\s+as\s+/).pop())
      .filter(Boolean),
  ),
]);

const missingIds = [...usedIds].filter((id) => !htmlIds.has(id)).sort();
const missingExports = [...new Set(imported)].filter((sym) => !exported.has(sym)).sort();

console.log(`id в index.html: ${htmlIds.size}`);
console.log(`id, к которым обращается src/app.js: ${usedIds.size} -> ${[...usedIds].sort().join(', ')}`);
console.log(`импортов из logic.js: ${new Set(imported).size} -> ${[...new Set(imported)].sort().join(', ')}`);
console.log(`отсутствующих id: ${missingIds.length}${missingIds.length ? ' -> ' + missingIds.join(', ') : ''}`);
console.log(
  `отсутствующих экспортов: ${missingExports.length}${missingExports.length ? ' -> ' + missingExports.join(', ') : ''}`,
);

const ok = missingIds.length === 0 && missingExports.length === 0;
console.log(ok ? 'ВЕРДИКТ: расхождений нет' : 'ВЕРДИКТ: есть расхождения');
process.exit(ok ? 0 : 1);
