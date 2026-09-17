// Сверка UI с ядром для каждого варианта: id из разметки vs обращения в его app.js и импорты из logic.js.
// ponytail: регулярки вместо парсера — разметка и код наши, схемы простые.
// Лежит вне test/, иначе node --test подхватывает файл как тест.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Варианты интерфейса: у каждого своя разметка и свой UI-слой, ядро общее.
const VARIANTS = [
  { title: 'основной вариант', html: 'index.html', app: 'src/app.js' },
  { title: 'вариант 2 (журнал)', html: 'v2/index.html', app: 'v2/app.js' },
];

const logic = readFileSync(path.join(root, 'src', 'logic.js'), 'utf8');

const exported = new Set([
  ...[...logic.matchAll(/export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  ...[...logic.matchAll(/export\s*\{([^}]+)\}/g)].flatMap((m) =>
    m[1]
      .split(',')
      .map((raw) => raw.trim().split(/\s+as\s+/).pop())
      .filter(Boolean),
  ),
]);

let failed = 0;

for (const variant of VARIANTS) {
  const html = readFileSync(path.join(root, variant.html), 'utf8');
  const app = readFileSync(path.join(root, variant.app), 'utf8');

  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

  // $('x') в коде — это document.getElementById('x'), поэтому учитываем оба вида.
  const usedIds = new Set([
    ...[...app.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ...[...app.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ...[...app.matchAll(/querySelector\(\s*['"]#([A-Za-z][\w-]*)['"]\s*\)/g)].map((m) => m[1]),
  ]);

  // путь импорта ядра не важен: первый вариант берёт ./logic.js, второй — ../src/logic.js
  const imported = [...app.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]*logic\.js['"]/g)]
    .flatMap((block) => block[1].split(','))
    .map((raw) => raw.trim().split(/\s+as\s+/)[0])
    .filter(Boolean);

  const missingIds = [...usedIds].filter((id) => !htmlIds.has(id)).sort();
  const missingExports = [...new Set(imported)].filter((sym) => !exported.has(sym)).sort();

  console.log(`\n=== ${variant.title} (${variant.html} + ${variant.app}) ===`);
  console.log(`id в разметке: ${htmlIds.size}`);
  console.log(`id, к которым обращается код: ${usedIds.size} -> ${[...usedIds].sort().join(', ')}`);
  console.log(`импортов из logic.js: ${new Set(imported).size} -> ${[...new Set(imported)].sort().join(', ')}`);
  console.log(`отсутствующих id: ${missingIds.length}${missingIds.length ? ' -> ' + missingIds.join(', ') : ''}`);
  console.log(
    `отсутствующих экспортов: ${missingExports.length}${missingExports.length ? ' -> ' + missingExports.join(', ') : ''}`,
  );

  const ok = missingIds.length === 0 && missingExports.length === 0;
  if (!ok) failed += 1;
  console.log(ok ? 'расхождений нет' : 'есть расхождения');
}

console.log(`\nВЕРДИКТ: ${failed ? `расхождения в вариантах: ${failed}` : 'расхождений нет ни в одном варианте'}`);
process.exit(failed ? 1 : 0);
