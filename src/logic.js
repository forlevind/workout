// Чистое ядро логики: без DOM, хранилища, звука и собственных таймеров.
// Время внутрь приходит аргументом (tick(dt)), рисует всё UI.

let idCounter = 0;

// crypto.randomUUID есть в браузере и Node 24; fallback — на случай старых сред.
const newId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now()}-${++idCounter}`;

const ex = (name, reps, extra = {}) => ({
  id: newId(),
  name,
  type: 'reps',
  reps,
  seconds: null,
  section: 'main',
  done: false,
  ...extra,
});

// ponytail: разминка — минимальное разумное дополнение к обязательному списку
// (суставная подготовка), не более 3 пунктов, без инвентаря.
export const DEFAULT_WORKOUT = [
  ex('Суставная разминка (шея, плечи, кисти)', 10, { section: 'warmup' }),
  ex('Наклоны корпуса в стороны', 10, { section: 'warmup' }),
  ex('Вращения таза', 10, { section: 'warmup' }),

  ex('Приседания', 20),
  ex('Отжимания', 20),
  ex('Выпады', 10, { note: 'на каждую ногу' }),
  ex('Берпи', 15),
  ex('Ягодичный мостик', 2, { type: 'time', seconds: 30 }),
  ex('Подтягивания с резинкой', 10),
  ex('«Скалолаз» лёжа', 20),

  ex('Перенос прямых ног над бутылкой влево-вправо', 15, { section: 'abs' }),
  ex('Обвод бутылок согнутыми ногами', 15, { section: 'abs' }),
  ex('Обвод бутылки прямыми ногами по бокам', 15, { section: 'abs' }),
  ex('Подъём ног над бутылками поочерёдно', 15, { section: 'abs' }),

  ex('Планка', 1, { type: 'time', seconds: 60 }),
];

// ---------- CRUD (чистые функции, вход не мутируется) ----------

export function addExercise(list, { name, type = 'reps', reps = 10, seconds = null, section = 'main' } = {}) {
  const sec = Number(seconds);
  return [
    ...list,
    {
      id: newId(),
      name: String(name ?? '').trim() || 'Упражнение',
      type,
      reps: Number(reps) || 0,
      seconds: type === 'time' ? (Number.isFinite(sec) ? sec : 30) : null,
      section,
      done: false,
    },
  ];
}

export function updateExercise(list, id, patch) {
  return list.map((item) => (item.id === id ? { ...item, ...patch, id: item.id } : item));
}

export function removeExercise(list, id) {
  return list.filter((item) => item.id !== id);
}

export function moveExercise(list, id, delta) {
  const from = list.findIndex((item) => item.id === id);
  const to = from + (Number(delta) || 0);
  if (from === -1 || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function toggleDone(list, id) {
  return list.map((item) => (item.id === id ? { ...item, done: !item.done } : item));
}

export function resetProgress(list) {
  return list.map((item) => (item.done ? { ...item, done: false } : item));
}

// ---------- Оценка калорий (приблизительная) ----------

export const KCAL_DISCLAIMER =
  'Это ориентировочная оценка, а не медицински точный показатель.';

// Точное время повтора неизвестно, берём средний темп.
// ponytail: 3 с/повтор — грубая константа; при появлении реальных замеров заменить на фактическое время.
const SEC_PER_REP = 3;

// MET по стемам имени (нижний регистр): силовые ~3.5–5, берпи/скалолаз ~8, планка ~3.5.
const MET_BY_NAME = {
  присед: 5,
  отжим: 5,
  выпад: 4,
  берпи: 8,
  мостик: 3.5,
  подтягив: 5,
  скалолаз: 8,
  планка: 3.5,
  бутыл: 4, // упражнения пресса с бутылками
};
const MET_BY_TYPE = { reps: 4, time: 3.5 };
const MET_WARMUP = 3;

function metFor(exercise) {
  const name = String(exercise?.name ?? '').toLowerCase();
  for (const [stem, met] of Object.entries(MET_BY_NAME)) if (name.includes(stem)) return met;
  if (exercise?.section === 'warmup') return MET_WARMUP;
  return MET_BY_TYPE[exercise?.type] ?? MET_BY_TYPE.reps;
}

function minutesFor(exercise) {
  const reps = Number(exercise?.reps) || 0;
  if (exercise?.type === 'time') return (reps * (Number(exercise.seconds) || 0)) / 60;
  return (reps * SEC_PER_REP) / 60;
}

// kcal = MET * 3.5 * weightKg / 200 * minutes
export function estimateKcal({ weightKg, exercise } = {}) {
  const weight = Number(weightKg);
  if (!Number.isFinite(weight) || weight <= 0) return null;
  if (!exercise || typeof exercise !== 'object') return null;
  const kcal = (metFor(exercise) * 3.5 * weight * minutesFor(exercise)) / 200;
  return Number.isFinite(kcal) ? Math.round(kcal) : null;
}

export function estimateWorkoutKcal({ weightKg, exercises } = {}) {
  const weight = Number(weightKg);
  if (!Number.isFinite(weight) || weight <= 0) return null;
  if (!Array.isArray(exercises)) return 0;
  let total = 0;
  for (const exercise of exercises) total += estimateKcal({ weightKg: weight, exercise }) ?? 0;
  return total;
}

// ---------- Машина состояний таймера (без таймеров внутри) ----------
// idle -> leadin -> work -> setDone --(next())--> leadin -> work ... -> finished
// Автоперехода setDone -> work НЕТ: следующий повтор запускает только next().

export function createTimer({ sets = 1, seconds = 0, leadIn = 3 } = {}) {
  const totalSets = Math.max(1, Math.floor(Number(sets) || 1));
  const setSeconds = Math.max(0, Number(seconds) || 0);
  const leadInSeconds = Math.max(0, Number(leadIn) || 0);

  let phase = 'idle';
  let setIndex = 0; // индекс текущего/следующего повтора, 0-based
  let remaining = 0; // секунд до конца текущей фазы
  let paused = false;
  let justFinished = false; // сигнал «финал только что наступил» — один раз

  const snapshot = () =>
    Object.freeze({
      phase,
      setIndex,
      totalSets,
      remaining,
      secondsLeftInLeadIn: phase === 'leadin' ? remaining : 0,
      isFinalSet: setIndex === totalSets - 1,
      finished: phase === 'finished',
      justFinished: justFinished && phase === 'finished',
      paused,
    });

  function start() {
    if (phase !== 'idle' && phase !== 'finished') return snapshot();
    paused = false;
    justFinished = false;
    setIndex = 0;
    phase = 'leadin';
    remaining = leadInSeconds;
    return snapshot();
  }

  function next() {
    if (phase !== 'setDone') return snapshot();
    if (setIndex + 1 >= totalSets) {
      phase = 'finished';
      remaining = 0;
      justFinished = true;
      return snapshot();
    }
    setIndex += 1;
    justFinished = false;
    phase = 'leadin';
    remaining = leadInSeconds;
    return snapshot();
  }

  function tick(dt = 0) {
    justFinished = false;
    let left = Number(dt);
    if (paused || !Number.isFinite(left) || left <= 0) return snapshot();
    if (phase !== 'leadin' && phase !== 'work') return snapshot();

    while (left > 0) {
      if (remaining > left) {
        remaining -= left;
        break;
      }
      left -= remaining;
      if (phase === 'leadin') {
        phase = 'work';
        remaining = setSeconds;
      } else {
        remaining = 0;
        if (setIndex === totalSets - 1) {
          phase = 'finished';
          justFinished = true;
        } else {
          phase = 'setDone'; // дальше только по next()
        }
        break;
      }
    }
    return snapshot();
  }

  function pause() {
    if (phase === 'leadin' || phase === 'work') paused = true;
    return snapshot();
  }

  function resume() {
    paused = false;
    return snapshot();
  }

  function reset() {
    phase = 'idle';
    setIndex = 0;
    remaining = 0;
    paused = false;
    justFinished = false;
    return snapshot();
  }

  return { start, next, tick, pause, resume, reset, state: snapshot };
}
