// Проверка «перед каждым подходом — не меньше трёх предупреждающих сигналов» на живом src/app.js.
// Методика: DOM-заглушка + фейковый WebAudio; каждый тон — отдельный осциллятор, его частоту
// пишем в журнал (880 — предупреждение, 1000 — тик, 660/990 — конец подхода, 523/659/784 — финал).
// Лежит в tools/, а не в test/: иначе node --test подхватил бы файл как тест.
// ponytail: объекты-заглушки вместо jsdom — приложению нужна горстка DOM-API, схема простая.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Проверяем каждый вариант интерфейса: ядро общее, а слой показа у них свой.
const APPS = [
  ['основной вариант', 'src/app.js'],
  ['вариант 2 (журнал)', 'v2/app.js'],
];

const FRAME = 1000 / 30; // кадр «60 Гц»: ровный ритм и «залипание» проверяются одним и тем же шагом
const LEAD_IN = 3; // столько же, сколько LEAD_IN в src/app.js
const SETS = 2;
const SECONDS = 5;

// ---------- Стенд: DOM-заглушка + фейковый WebAudio ----------

function makeHarness() {
  const tones = []; // частоты осцилляторов — журнал всех сигналов в порядке подачи
  const beats = []; // цифры, показанные с пульсацией (replay(timerBig, 'is-beat'))
  const created = [];
  const byId = new Map();
  const docHandlers = {};
  const store = new Map();
  let now = 0;
  let pending = null;
  let rafSeq = 0;

  class FakeCtx {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = { connect: () => {} };
    }
    resume() {
      return Promise.resolve();
    }
    createOscillator() {
      const osc = {
        type: 'sine',
        frequency: { value: 0 },
        connect: (target) => target,
        start: () => tones.push(osc.frequency.value),
        stop: () => {},
      };
      return osc;
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect: (target) => target,
      };
    }
  }

  class El {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.handlers = {};
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this._text = '';
      this.classList = {
        // app пишет цифру в timerBig и сразу зовёт replay() — здесь и снимаем показанное
        add: (name) => {
          if (name === 'is-beat') beats.push(this._text);
        },
        remove: () => {},
        contains: () => false,
      };
    }
    get textContent() {
      return this._text;
    }
    set textContent(value) {
      this._text = String(value);
    }
    append(...nodes) {
      this.children.push(...nodes);
      return this;
    }
    setAttribute() {}
    getAttribute() {
      return null;
    }
    addEventListener(type, handler) {
      (this.handlers[type] ||= []).push(handler);
    }
    reset() {}
    focus() {}
    closest() {
      return null;
    }
    dispatch(type, event) {
      for (const handler of this.handlers[type] ?? []) handler(event);
    }
  }

  const doc = {
    visibilityState: 'visible',
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, new El('div'));
      return byId.get(id);
    },
    createElement(tag) {
      const el = new El(tag);
      created.push(el);
      return el;
    },
    addEventListener(type, handler) {
      (docHandlers[type] ||= []).push(handler);
    },
  };

  globalThis.document = doc;
  globalThis.window = { AudioContext: FakeCtx };
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
  globalThis.requestAnimationFrame = (cb) => {
    pending = cb;
    rafSeq += 1;
    return rafSeq;
  };
  globalThis.cancelAnimationFrame = () => {
    pending = null;
  };

  const step = (ms = FRAME) => {
    assert.ok(pending, 'кадр не запланирован: таймер уже остановился');
    const cb = pending;
    pending = null;
    now += ms;
    cb(now);
  };

  const drain = (maxFrames = 4000) => {
    let frames = 0;
    while (pending && frames < maxFrames) {
      step();
      frames += 1;
    }
    assert.ok(frames < maxFrames, `таймер не остановился сам за ${maxFrames} кадров`);
  };

  return { doc, docHandlers, created, tones, beats, byId, step, drain };
}

// Каждый прогон — отдельный экземпляр модуля: у app.js есть состояние (state, timer, audioCtx).
// boot() пересоздаётся на каждый вариант, поэтому счётчик кэша импорта у них независимый.
function makeBoot(APP) {
  let boots = 0;
  return async function boot() {
    const harness = makeHarness();
    boots += 1;
    await import(`${APP}?case=${boots}`);
    return harness;
  };
}

let boot = null; // назначается перед прогоном каждого варианта

const el = (harness, id) => harness.byId.get(id);

// Проверяемое упражнение заводим через форму: 2 подхода по 5 секунд — предсказуемые метки.
function addTimeExercise(harness) {
  el(harness, 'nameInput').value = 'Проверка сигналов';
  el(harness, 'typeSelect').value = 'time';
  el(harness, 'repsInput').value = String(SETS);
  el(harness, 'secondsInput').value = String(SECONDS);
  el(harness, 'sectionSelect').value = 'main';
  const mark = harness.created.length;
  el(harness, 'exerciseForm').dispatch('submit', { preventDefault() {} });
  const starts = harness.created.slice(mark).filter((node) => node.dataset.action === 'start');
  assert.ok(starts.length >= 1, 'форма не создала кнопку «Старт» для упражнения на время');
  return starts.at(-1); // карточка нового упражнения рендерится последней
}

const clickStart = (harness, button) =>
  el(harness, 'workoutList').dispatch('click', { target: { closest: () => button } });
const clickNext = (harness) => el(harness, 'timerNextBtn').dispatch('click', {});

// Компактный журнал для отчёта: [880, 880, 880, 1000, 1000] -> «880×3, 1000×2».
function journal(tones) {
  const groups = tones.reduce((acc, freq) => {
    const last = acc.at(-1);
    if (last && last.freq === freq) last.count += 1;
    else acc.push({ freq, count: 1 });
    return acc;
  }, []);
  return groups.map(({ freq, count }) => (count > 1 ? `${freq}x${count}` : `${freq}`)).join(', ') || '(тишина)';
}

const leadInCount = (harness) => harness.tones.filter((freq) => freq === 880).length;
const marks = (harness) => harness.beats.map(Number);

// Ожидаемая полная партитура одного подхода у этого упражнения:
// 3 предупреждения -> 4 тика (метки 4,3,2,1; «5» показывается при входе в работу без сигнала)
const SET_ONCE = [880, 880, 880, 1000, 1000, 1000, 1000, 660, 990];

// ---------- Сценарии ----------

const cases = [];
const scenario = (name, body) => cases.push([name, body]);

scenario('dt = 1/30 с: три предупреждения перед каждым подходом, тик ровно раз в секунду', async () => {
  const harness = await boot();
  clickStart(harness, addTimeExercise(harness));
  harness.drain();

  assert.deepEqual(harness.tones, SET_ONCE, 'первый подход: 3 предупреждения, 4 тика, сигнал конца подхода');
  assert.ok(leadInCount(harness) >= LEAD_IN, `перед первым подходом предупреждений ${leadInCount(harness)}`);

  clickNext(harness);
  harness.drain();

  assert.deepEqual(harness.tones, [...SET_ONCE, ...SET_ONCE.slice(0, 7), 523, 659, 784], 'второй подход + финальная тройка');
  assert.deepEqual(marks(harness), [3, 2, 1, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1], 'цифры на экране: без пропусков и дублей');
  assert.equal(harness.tones.filter((freq) => [523, 659, 784].includes(freq)).length, 3, 'финальная тройка прозвучала ровно один раз');

  return `тоны: ${journal(harness.tones)}`;
});

scenario('dt = [1.5, 1.5, 1.5] с (залипание кадра): предупреждений всё равно не меньше трёх', async () => {
  const harness = await boot();
  clickStart(harness, addTimeExercise(harness));
  harness.step(1000); // базовая отметка ровно 1 с — dt получается точно 1,5 без float-шума
  harness.step(1500);
  harness.step(1500);
  harness.step(1500);

  assert.ok(
    leadInCount(harness) >= LEAD_IN,
    `предупреждений ${leadInCount(harness)}, ожидалось не меньше ${LEAD_IN}`,
  );
  assert.deepEqual(marks(harness).slice(0, LEAD_IN), [3, 2, 1], 'ряд «3», «2», «1» прозвучал целиком');

  harness.drain();
  assert.deepEqual(harness.tones, SET_ONCE, 'после залипания подход идёт обычным порядком');

  return `предупреждений перед подходом: ${leadInCount(harness)}; тоны: ${journal(harness.tones)}`;
});

scenario('возврат вкладки из фона: фоновое время не засчитано, отсчёт продолжается с места ухода', async () => {
  const harness = await boot();
  clickStart(harness, addTimeExercise(harness));
  harness.step(); // базовая отметка
  for (let i = 0; i < 5; i += 1) harness.step(); // ~0,17 с подготовки прошло

  harness.doc.visibilityState = 'visible';
  for (const handler of harness.docHandlers.visibilitychange ?? []) handler();
  harness.step(60000); // «вернулись через минуту»

  assert.deepEqual(marks(harness), [3], 'возврат не съел подготовку и не телепортировал упражнение');
  assert.deepEqual(harness.tones, [880], 'в фоне и на возврате молчали — подан пока один сигнал');

  harness.drain();
  assert.deepEqual(harness.tones, SET_ONCE, 'после возврата: 3 предупреждения и полный набор тиков');
  assert.ok(leadInCount(harness) >= LEAD_IN, 'предупреждения перед подходом не потерялись');

  return `предупреждений перед подходом: ${leadInCount(harness)}; тоны: ${journal(harness.tones)}`;
});

scenario('один кадр dt = 4 с (остановка главного потока): три предупреждения успевают прозвучать', async () => {
  const harness = await boot();
  clickStart(harness, addTimeExercise(harness));
  harness.step();
  harness.step(4000);

  assert.ok(
    leadInCount(harness) >= LEAD_IN,
    `предупреждений ${leadInCount(harness)}, ожидалось не меньше ${LEAD_IN}`,
  );

  harness.drain();
  assert.deepEqual(harness.tones, [880, 880, 880, 1000, 1000, 1000, 660, 990], 'подход доигрывается без пропущенных тиков');

  return `предупреждений перед подходом: ${leadInCount(harness)}; тоны: ${journal(harness.tones)}`;
});

// ---------- Прогон ----------

let failed = 0;
let total = 0;
for (const [appTitle, appFile] of APPS) {
  boot = makeBoot(pathToFileURL(path.join(root, appFile)).href);
  console.log(`\n=== ${appTitle} (${appFile}) ===`);
  for (const [name, body] of cases) {
    total += 1;
    try {
      const note = await body();
      console.log(`OK   ${name}${note ? `\n     ${note}` : ''}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${name}\n     ${error.message.split('\n').join('\n     ')}`);
    }
  }
}

console.log(
  failed
    ? `ВЕРДИКТ: провалов ${failed} из ${total} (вариантов: ${APPS.length})`
    : `ВЕРДИКТ: все ${total} проверки пройдены в ${APPS.length} вариантах`,
);
process.exit(failed ? 1 : 0);
