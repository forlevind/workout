// Живой запуск `node server.js`: статусы и MIME, затем сервер гасится.
// ponytail: дочерний процесс, а не import('../server.js') — на Windows process.exit
// с живым listening-socket роняет libuv («Assertion failed ... UV_HANDLE_CLOSING»).
// Лежит вне test/, иначе node --test подхватывает файл как тест.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = 'http://localhost:5173';
const targets = [
  ['/', 'text/html; charset=utf-8'],
  ['/styles.css', 'text/css; charset=utf-8'],
  ['/src/app.js', 'text/javascript; charset=utf-8'],
  ['/src/logic.js', 'text/javascript; charset=utf-8'],
];

const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
let failed = 0;

try {
  // сервер печатает адрес после listen; таймаут — страховка от зависания
  await Promise.race([new Promise((resolve) => child.stdout.once('data', resolve)), new Promise((r) => setTimeout(r, 3000))]);
  console.log(`сервер запущен: ${BASE}`);

  for (const [pathname, expectedType] of targets) {
    const response = await fetch(BASE + pathname);
    const type = response.headers.get('content-type');
    const ok = response.status === 200 && type === expectedType;
    if (!ok) failed += 1;
    console.log(`${ok ? 'OK  ' : 'FAIL'} GET ${pathname} -> ${response.status} ${type}`);
  }

  // trust boundary сервера: попытка выйти за корень
  const escape = await fetch(`${BASE}/%2e%2e%2fserver.js`);
  const escapeOk = escape.status === 403 || escape.status === 404;
  if (!escapeOk) failed += 1;
  console.log(`${escapeOk ? 'OK  ' : 'FAIL'} GET /%2e%2e%2fserver.js -> ${escape.status} (вне корня: 403/404)`);
} finally {
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
  console.log('сервер остановлен, порт 5173 освобождён');
}

console.log(failed ? `ВЕРДИКТ: провалов ${failed}` : 'ВЕРДИКТ: все проверки пройдены');
process.exitCode = failed ? 1 : 0;
