import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WORKOUT,
  KCAL_DISCLAIMER,
  addExercise,
  updateExercise,
  removeExercise,
  moveExercise,
  toggleDone,
  resetProgress,
  estimateKcal,
  estimateWorkoutKcal,
  createTimer,
} from '../src/logic.js';

const byName = (part, list = DEFAULT_WORKOUT) => list.find((e) => e.name.includes(part));
const idx = (part, list = DEFAULT_WORKOUT) => list.findIndex((e) => e.name.includes(part));

test('DEFAULT_WORKOUT: обязательные пункты и их параметры', () => {
  assert.ok(DEFAULT_WORKOUT.length >= 15);

  const squats = byName('Приседания');
  assert.equal(squats.type, 'reps');
  assert.equal(squats.reps, 20);
  assert.equal(squats.section, 'main');

  assert.equal(byName('Отжимания').reps, 20);

  const lunges = byName('Выпады');
  assert.equal(lunges.reps, 10);
  assert.equal(lunges.note, 'на каждую ногу');

  assert.equal(byName('Берпи').reps, 15);

  const bridge = byName('Ягодичный мостик');
  assert.equal(bridge.type, 'time');
  assert.equal(bridge.reps, 2);
  assert.equal(bridge.seconds, 30);

  assert.equal(byName('Подтягивания с резинкой').reps, 10);
  assert.equal(byName('Скалолаз').reps, 20);

  const abs = DEFAULT_WORKOUT.filter((e) => e.section === 'abs');
  assert.equal(abs.length, 4);
  for (const e of abs) {
    assert.equal(e.type, 'reps');
    assert.equal(e.reps, 15);
  }

  const plank = byName('Планка');
  assert.equal(plank.type, 'time');
  assert.equal(plank.reps, 1);
  assert.equal(plank.seconds, 60);
  assert.equal(plank.section, 'main');
});

test('DEFAULT_WORKOUT: порядок, структура элементов, уникальные id', () => {
  const order = [
    'Приседания',
    'Отжимания',
    'Выпады',
    'Берпи',
    'Ягодичный мостик',
    'Подтягивания',
    'Скалолаз',
    'Перенос прямых ног',
    'Обвод бутылок согнутыми',
    'Обвод бутылки прямыми',
    'Подъём ног',
    'Планка',
  ];
  for (let i = 1; i < order.length; i++) {
    assert.ok(idx(order[i - 1]) < idx(order[i]), `нарушен порядок: ${order[i - 1]} → ${order[i]}`);
  }

  // разминка идёт первой и минимальна
  const warmup = DEFAULT_WORKOUT.filter((e) => e.section === 'warmup');
  assert.ok(warmup.length >= 3 && warmup.length <= 4);
  assert.equal(DEFAULT_WORKOUT[0].section, 'warmup');
  for (const e of warmup) assert.equal(e.type, 'reps');

  for (const e of DEFAULT_WORKOUT) {
    assert.equal(typeof e.id, 'string');
    assert.ok(e.id.length > 0);
    assert.equal(typeof e.name, 'string');
    assert.ok(['reps', 'time'].includes(e.type));
    assert.ok(['warmup', 'main', 'abs'].includes(e.section));
    assert.equal(typeof e.reps, 'number');
    assert.ok(e.seconds === null || typeof e.seconds === 'number');
    assert.equal(e.done, false);
  }

  assert.equal(new Set(DEFAULT_WORKOUT.map((e) => e.id)).size, DEFAULT_WORKOUT.length);
});

test('CRUD: addExercise не мутирует вход и добавляет корректный элемент', () => {
  const before = structuredClone(DEFAULT_WORKOUT);
  const added = addExercise(DEFAULT_WORKOUT, { name: 'Тестовое', type: 'reps', reps: 5 });

  assert.notEqual(added, DEFAULT_WORKOUT);
  assert.deepEqual(DEFAULT_WORKOUT, before); // вход не изменён
  assert.equal(added.length, DEFAULT_WORKOUT.length + 1);

  const item = added.at(-1);
  assert.equal(item.name, 'Тестовое');
  assert.equal(item.reps, 5);
  assert.equal(item.seconds, null);
  assert.equal(item.done, false);
  assert.equal(typeof item.id, 'string');

  const timed = addExercise(added, { name: 'Планка-тест', type: 'time', reps: 1, seconds: 45 });
  assert.equal(timed.at(-1).seconds, 45);
  assert.equal(timed.at(-1).type, 'time');
});

test('CRUD: updateExercise правит только нужный элемент и не мутирует вход', () => {
  const before = structuredClone(DEFAULT_WORKOUT);
  const id = DEFAULT_WORKOUT[0].id;
  const updated = updateExercise(DEFAULT_WORKOUT, id, { reps: 99, name: 'Разминка+', id: 'hack' });

  assert.deepEqual(DEFAULT_WORKOUT, before);
  assert.equal(updated[0].reps, 99);
  assert.equal(updated[0].name, 'Разминка+');
  assert.equal(updated[0].id, id); // id защищён от подмены
  assert.equal(updated[1].reps, DEFAULT_WORKOUT[1].reps);

  const noop = updateExercise(DEFAULT_WORKOUT, 'нет-такого-id', { reps: 1 });
  assert.deepEqual(noop, DEFAULT_WORKOUT);
});

test('CRUD: removeExercise на первом, последнем и несуществующем id', () => {
  const before = structuredClone(DEFAULT_WORKOUT);
  const first = DEFAULT_WORKOUT[0].id;
  const last = DEFAULT_WORKOUT.at(-1).id;

  const withoutFirst = removeExercise(DEFAULT_WORKOUT, first);
  assert.equal(withoutFirst.length, DEFAULT_WORKOUT.length - 1);
  assert.ok(!withoutFirst.some((e) => e.id === first));

  const withoutLast = removeExercise(DEFAULT_WORKOUT, last);
  assert.ok(!withoutLast.some((e) => e.id === last));

  const untouched = removeExercise(DEFAULT_WORKOUT, 'нет-такого-id');
  assert.deepEqual(untouched, DEFAULT_WORKOUT);
  assert.deepEqual(DEFAULT_WORKOUT, before);
});

test('CRUD: moveExercise двигает вверх/вниз и безопасен на границах', () => {
  const list = [1, 2, 3, 4].map((n) => ({ id: 'id' + n, name: 'e' + n }));
  const before = structuredClone(list);
  const names = (l) => l.map((e) => e.name).join(',');

  assert.equal(names(moveExercise(list, 'id2', -1)), 'e2,e1,e3,e4');
  assert.equal(names(moveExercise(list, 'id2', 1)), 'e1,e3,e2,e4');
  assert.equal(moveExercise(list, 'id1', -1), list); // верхняя граница — без изменений
  assert.equal(moveExercise(list, 'id4', 1), list); // нижняя граница — без изменений
  assert.equal(moveExercise(list, 'нет-такого-id', 1), list); // несуществующий id
  assert.deepEqual(moveExercise(list, 'id1', 0), list); // нулевой сдвиг — позиция не меняется
  assert.deepEqual(list, before);
});

test('CRUD: toggleDone и resetProgress', () => {
  const before = structuredClone(DEFAULT_WORKOUT);
  const id = DEFAULT_WORKOUT[2].id;

  const done = toggleDone(DEFAULT_WORKOUT, id);
  assert.equal(done[2].done, true);
  assert.equal(done[3].done, false);
  assert.deepEqual(DEFAULT_WORKOUT, before);

  const undone = toggleDone(done, id);
  assert.equal(undone[2].done, false);

  const noop = toggleDone(DEFAULT_WORKOUT, 'нет-такого-id');
  assert.deepEqual(noop, DEFAULT_WORKOUT);

  const partial = toggleDone(DEFAULT_WORKOUT, id);
  const reset = resetProgress(partial);
  assert.ok(reset.every((e) => e.done === false));
  assert.deepEqual(DEFAULT_WORKOUT, before);
});

test('kcal: формула, null без веса, отсутствие NaN', () => {
  const squats = byName('Приседания'); // MET 5, 20 повторов * 3 с = 1 мин
  const expected = Math.round((5 * 3.5 * 70) / 200 * ((20 * 3) / 60));
  assert.equal(estimateKcal({ weightKg: 70, exercise: squats }), expected);
  assert.equal(estimateKcal({ weightKg: 70, exercise: squats }), 6);

  const plank = byName('Планка'); // time: 1 * 60 / 60 = 1 мин, MET 3.5
  assert.equal(estimateKcal({ weightKg: 70, exercise: plank }), 4);

  assert.equal(estimateKcal({ weightKg: 0, exercise: squats }), null);
  assert.equal(estimateKcal({ weightKg: -5, exercise: squats }), null);
  assert.equal(estimateKcal({ weightKg: 'нечисло', exercise: squats }), null);
  assert.equal(estimateKcal({ exercise: squats }), null);
  assert.equal(estimateKcal(), null);
  assert.equal(estimateKcal({ weightKg: 70 }), null);

  const weird = [
    { weightKg: 70, exercise: { name: 'x', type: 'reps', reps: 0 } },
    { weightKg: 70, exercise: { name: 'x', type: 'reps' } },
    { weightKg: 70, exercise: { name: 'x', type: 'time', reps: 1, seconds: null } },
    { weightKg: 70, exercise: {} },
  ];
  for (const input of weird) {
    const value = estimateKcal(input);
    assert.ok(value === null || Number.isFinite(value), 'вернулся NaN/Infinity');
  }
});

test('kcal: сумма ≥ одного упражнения и монотонность по весу', () => {
  const total = estimateWorkoutKcal({ weightKg: 70, exercises: DEFAULT_WORKOUT });
  const one = estimateKcal({ weightKg: 70, exercise: byName('Берпи') });
  assert.ok(total >= one);
  assert.ok(total > 0);
  assert.ok(Number.isFinite(total));

  const light = estimateWorkoutKcal({ weightKg: 55, exercises: DEFAULT_WORKOUT });
  const heavy = estimateWorkoutKcal({ weightKg: 95, exercises: DEFAULT_WORKOUT });
  assert.ok(light <= total && total <= heavy);

  assert.equal(estimateWorkoutKcal({ exercises: DEFAULT_WORKOUT }), null);
  assert.equal(estimateWorkoutKcal({ weightKg: 70, exercises: 'нет' }), 0);

  assert.equal(typeof KCAL_DISCLAIMER, 'string');
  assert.ok(KCAL_DISCLAIMER.length > 10);
  assert.ok(/ориентировочн/i.test(KCAL_DISCLAIMER));
});

test('таймер: leadIn=3, работа не начинается раньше 3 секунд', () => {
  const t = createTimer({ sets: 2, seconds: 10, leadIn: 3 });
  assert.equal(t.state().phase, 'idle');
  assert.equal(t.state().totalSets, 2);

  t.start();
  assert.equal(t.state().phase, 'leadin');
  assert.equal(t.state().secondsLeftInLeadIn, 3);
  assert.equal(t.state().isFinalSet, false);

  t.tick(1);
  t.tick(1);
  assert.equal(t.state().phase, 'leadin', 'после 2 с работа ещё не началась');
  t.tick(0.999);
  assert.equal(t.state().phase, 'leadin', 'после 2.999 с работа ещё не началась');
  assert.ok(t.state().secondsLeftInLeadIn > 0);

  t.tick(0.01); // 3.009 с суммарно
  assert.equal(t.state().phase, 'work', 'работа начинается только после 3 с');
  assert.ok(t.state().remaining < 10 && t.state().remaining > 9.9, 'остаток повтора уменьшен на излишек dt');
});

test('ГЛАВНОЕ: setDone не переходит в work сам, только по next()', () => {
  const t = createTimer({ sets: 2, seconds: 10, leadIn: 3 });
  t.start();
  t.tick(3);
  assert.equal(t.state().phase, 'work');
  t.tick(10);
  assert.equal(t.state().phase, 'setDone');
  assert.equal(t.state().setIndex, 0);
  assert.equal(t.state().remaining, 0);

  // накручиваем 5 минут — ничего не меняется
  for (let i = 0; i < 300; i++) t.tick(1);
  assert.equal(t.state().phase, 'setDone', 'работа не может начаться автоматически');
  assert.equal(t.state().setIndex, 0);

  // даже одним огромным dt
  t.tick(600);
  assert.equal(t.state().phase, 'setDone');
  assert.equal(t.state().setIndex, 0);

  // только явное действие
  t.next();
  assert.equal(t.state().phase, 'leadin');
  assert.equal(t.state().setIndex, 1);
  assert.equal(t.state().isFinalSet, true);
  assert.equal(t.state().secondsLeftInLeadIn, 3);

  t.tick(2.5);
  assert.equal(t.state().phase, 'leadin');
  t.tick(0.5);
  assert.equal(t.state().phase, 'work', 'второй повтор тоже начинается с leadin');
  assert.equal(t.state().phase === 'setDone', false);
});

test('таймер: последний повтор даёт finished + justFinished один раз', () => {
  const t = createTimer({ sets: 2, seconds: 10, leadIn: 3 });
  t.start();
  t.tick(3);
  t.tick(10);
  t.next();
  t.tick(3);

  t.tick(4);
  assert.equal(t.state().phase, 'work');
  assert.equal(t.state().remaining, 6);
  assert.equal(t.state().paused, false);

  t.tick(6);
  assert.equal(t.state().phase, 'finished');
  assert.equal(t.state().finished, true);
  assert.equal(t.state().justFinished, true);
  assert.equal(t.state().remaining, 0);
  assert.equal(t.state().isFinalSet, true);

  t.tick(0.016);
  assert.equal(t.state().justFinished, false, 'финальный сигнал не повторяется каждый кадр');
  assert.equal(t.state().finished, true);

  t.tick(600);
  assert.equal(t.state().phase, 'finished');
  assert.equal(t.state().remaining, 0);
});

test('таймер: одиночный повтор сразу даёт finished', () => {
  const t = createTimer({ sets: 1, seconds: 5, leadIn: 3 });
  t.start();
  t.tick(3);
  assert.equal(t.state().phase, 'work');
  assert.equal(t.state().isFinalSet, true);
  t.tick(1000);
  assert.equal(t.state().phase, 'finished');
  assert.equal(t.state().finished, true);
  assert.equal(t.state().justFinished, true);
});

test('таймер: pause/resume/reset и безопасность dt', () => {
  const t = createTimer({ sets: 3, seconds: 10, leadIn: 3 });
  t.start();
  t.pause();
  t.tick(100);
  assert.equal(t.state().phase, 'leadin', 'на паузе время не идёт');
  assert.equal(t.state().remaining, 3);
  assert.equal(t.state().paused, true);

  t.resume();
  assert.equal(t.state().paused, false);
  t.tick(3);
  assert.equal(t.state().phase, 'work');

  // dt=0, отрицательный, NaN, Infinity — не бросают
  for (const dt of [0, -5, NaN, Infinity, undefined, 'abc']) {
    assert.doesNotThrow(() => t.tick(dt));
    assert.ok(t.state().remaining >= 0, 'remaining не уходит в минус');
  }

  // большой dt на среднем повторе не проваливает в следующий повтор
  t.tick(10000);
  assert.equal(t.state().phase, 'setDone');
  assert.equal(t.state().setIndex, 0);

  // в фазе setDone любые вызовы безвредны
  assert.doesNotThrow(() => { t.tick(0); t.tick(1e9); t.start(); t.next(); t.resume(); });
  assert.equal(t.state().phase, 'leadin'); // start() в setDone — no-op, next() отработал

  t.reset();
  assert.equal(t.state().phase, 'idle');
  assert.equal(t.state().setIndex, 0);
  assert.equal(t.state().remaining, 0);
  assert.equal(t.state().finished, false);
  assert.equal(t.state().justFinished, false);
});

test('таймер: снимок иммутабелен снаружи', () => {
  const t = createTimer({ sets: 1, seconds: 10, leadIn: 3 });
  t.start();
  const snap = t.state();
  assert.ok(Object.isFrozen(snap));
  assert.throws(() => { snap.phase = 'hacked'; }, TypeError);
  assert.equal(t.state().phase, 'leadin');

  const keys = ['phase', 'setIndex', 'totalSets', 'remaining', 'secondsLeftInLeadIn', 'isFinalSet', 'finished', 'justFinished', 'paused'];
  assert.deepEqual(Object.keys(snap).sort(), [...keys].sort());
});
