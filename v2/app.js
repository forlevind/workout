// UI-слой варианта 2 (журнал в тёмно-зелёной теме): строки-карточки, нижний лист, таймер.
// Ядро общее с первым вариантом — ./../src/logic.js; данные тоже общие (localStorage 'workout.v1'),
// поэтому прогресс, вес и список видны в обоих вариантах.
import {
  DEFAULT_WORKOUT,
  addExercise,
  updateExercise,
  removeExercise,
  moveExercise,
  toggleDone,
  resetProgress,
  estimateKcal,
  estimateWorkoutKcal,
  KCAL_DISCLAIMER,
  createTimer,
} from '../src/logic.js';

const STORAGE_KEY = 'workout.v1';
const LEAD_IN = 3; // предупреждающих сигналов перед подходом
const SECTION_TITLES = { warmup: 'Разминка', main: 'Основная часть', abs: 'Пресс' };
const SECTIONS = Object.keys(SECTION_TITLES);

// ponytail: верхняя граница dt на один кадр (см. первый вариант): большой dt возможен только
// при возврате вкладки из фона, 90 с хватает на обычный троттлинг без телепорта через подход.
const MAX_DT = 90;

const $ = (id) => document.getElementById(id);
const ui = {
  weight: $('weightInput'),
  sound: $('soundToggle'),
  progress: $('progressText'),
  progressBar: $('progressBar'),
  wake: $('wakeStatus'),
  kcalNote: $('kcalDisclaimer'),
  finish: $('finishWorkoutBtn'),
  currentName: $('currentExercise'),
  currentParams: $('currentParams'),
  kcal: $('workoutKcal'),
  addBtn: $('addBtn'),
  sheet: $('sheet'),
  sheetClose: $('sheetCloseBtn'),
  list: $('workoutList'),
  resetProgress: $('resetProgressBtn'),
  resetWorkout: $('resetWorkoutBtn'),
  form: $('exerciseForm'),
  formTitle: $('formTitle'),
  name: $('nameInput'),
  type: $('typeSelect'),
  repsLabelText: $('repsLabelText'),
  reps: $('repsInput'),
  secondsField: $('secondsField'),
  seconds: $('secondsInput'),
  section: $('sectionSelect'),
  formError: $('formError'),
  submit: $('submitBtn'),
  cancel: $('cancelEditBtn'),
  status: $('status'),
  banner: $('banner'),
  timer: $('timer'),
  timerTitle: $('timerTitle'),
  timerPhase: $('timerPhase'),
  timerBig: $('timerBig'),
  tickDot: $('tickDot'),
  timerSets: $('timerSetInfo'),
  timerPause: $('timerPauseBtn'),
  timerNext: $('timerNextBtn'),
  timerDone: $('timerDoneBtn'),
  timerStop: $('timerStopBtn'),
};

const cloneWorkout = (list) => list.map((item) => ({ ...item }));

let state = { exercises: cloneWorkout(DEFAULT_WORKOUT), weightKg: null, soundOn: true };
let editingId = null;
let openMenuId = null; // id строки, у которой раскрыто меню «⋯»
let showDone = false; // «Показать выполненные»: скрытые строки можно вернуть и снять отметку

// ---------- Сохранение / восстановление ----------

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // приватный режим или переполнение квоты — работаем в памяти
  }
}

function load() {
  let data;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    data = JSON.parse(raw);
  } catch {
    return; // битый JSON — остаёмся на стартовом комплекте
  }
  if (!data || typeof data !== 'object') return;

  // trust boundary: данные из localStorage могли быть испорчены
  const exercises = Array.isArray(data.exercises) ? data.exercises.filter(isValidExercise).map(normalizeExercise) : [];
  if (exercises.length) state.exercises = exercises;

  const weight = Number(data.weightKg);
  state.weightKg = Number.isFinite(weight) && weight > 0 ? weight : null;
  state.soundOn = data.soundOn !== false;
}

function isValidExercise(item) {
  return (
    !!item &&
    typeof item === 'object' &&
    typeof item.name === 'string' &&
    item.name.trim() !== '' &&
    (item.type === 'reps' || item.type === 'time') &&
    SECTIONS.includes(item.section)
  );
}

function normalizeExercise(item) {
  const reps = Math.floor(Number(item.reps));
  const seconds = Math.floor(Number(item.seconds));
  const note = typeof item.note === 'string' ? item.note.trim() : '';
  return {
    id: typeof item.id === 'string' && item.id ? item.id : makeId(),
    name: item.name.trim(),
    type: item.type,
    reps: Number.isFinite(reps) && reps > 0 ? reps : 1,
    seconds: item.type === 'time' && Number.isFinite(seconds) && seconds > 0 ? seconds : item.type === 'time' ? 30 : null,
    section: item.section,
    done: item.done === true,
    ...(note ? { note } : {}),
  };
}

function makeId() {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
}

// ---------- Тексты ----------

function plural(n, one, few, many) {
  const t10 = n % 10;
  const t100 = n % 100;
  if (t10 === 1 && t100 !== 11) return one;
  if (t10 >= 2 && t10 <= 4 && (t100 < 12 || t100 > 14)) return few;
  return many;
}

// Подпись строки: короткие отрезки — в секундах, длинные — в формате «5:00 мин»
function durationText(totalSeconds) {
  if (totalSeconds < 60) return `${totalSeconds} сек`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')} мин`;
}

function paramsText(item) {
  if (item.type === 'time') {
    const perSet = durationText(item.seconds);
    const total = item.reps * item.seconds;
    const sets = item.reps > 1 ? `${perSet} × ${item.reps}` : perSet;
    // суммарное время показываем, только когда оно добавляет информацию и не ломает строку
    return total >= 60 && item.reps > 1 ? `${sets} · всего ${durationText(total)}` : sets;
  }
  const base = `${item.reps} ${plural(item.reps, 'повторение', 'повторения', 'повторений')}`;
  return item.note ? `${base} · ${item.note}` : base;
}

// ---------- Рендер ----------

function render() {
  ui.list.textContent = '';
  const pending = state.exercises.filter((item) => !item.done);
  const nextId = pending[0]?.id ?? null;
  const doneItems = [];
  let currentSection = null;

  state.exercises.forEach((item, index) => {
    if (item.section !== currentSection) {
      currentSection = item.section;
      ui.list.append(renderSectionLabel(item.section, index));
    }
    if (item.done) {
      doneItems.push({ item, index });
      return; // выполненные с экрана убираем: список показывает только то, что осталось сделать
    }
    ui.list.append(renderRow(item, index, item.id === nextId));
  });

  if (!pending.length && state.exercises.length) ui.list.append(renderAllDone());
  // отметку можно снять: выполненные прячутся, но по кнопке возвращаются на экран
  if (doneItems.length) ui.list.append(renderDoneToggle(doneItems.length));
  if (showDone) doneItems.forEach(({ item, index }) => ui.list.append(renderRow(item, index, false)));

  renderSummary();
  renderCurrent();
  return nextId; // нужен, чтобы подтянуть следующее упражнение к верху страницы
}

// Когда всё выполнено, список пуст — объясняем это и подсказываем, где сбросить отметки
function renderAllDone() {
  const box = document.createElement('p');
  box.className = 'empty-state';
  box.textContent = 'Все упражнения выполнены. Сбросить отметки — кнопка ↻ в шапке.';
  return box;
}

// Скрытые выполненные: по умолчанию их нет на экране, но вернуть и снять отметку можно
function renderDoneToggle(count) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'show-done';
  button.dataset.action = 'show-done';
  button.setAttribute('aria-expanded', String(showDone));
  button.textContent = showDone ? `Скрыть выполненные · ${count}` : `Показать выполненные · ${count}`;
  return button;
}

// Следующее упражнение встаёт на место законченного и подтягивается к верху экрана
function scrollToNext(id) {
  if (!id) return;
  syncScrollOffset();
  const row = document.getElementById(`row-${id}`);
  row?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
}

// Отступ прокрутки: если шапка когда-нибудь станет липкой, строку не накроет — высота считается по факту
function syncScrollOffset() {
  const root = document.documentElement;
  if (!root?.style || typeof document.querySelector !== 'function') return;
  const header = document.querySelector('.top');
  if (!header) return;
  const sticky = getComputedStyle(header).position === 'sticky';
  const gap = sticky ? Math.round(header.getBoundingClientRect().height) + 12 : 14;
  root.style.setProperty('--scroll-offset', `${gap}px`);
}

function renderSectionLabel(section, fromIndex) {
  let total = 0;
  let done = 0;
  for (let i = fromIndex; i < state.exercises.length; i += 1) {
    if (state.exercises[i].section !== section) break;
    total += 1;
    if (state.exercises[i].done) done += 1;
  }
  const complete = total > 0 && done === total;

  const row = document.createElement('div');
  row.className = `subhead${complete ? ' is-complete' : ''}`;
  if (complete) row.setAttribute('aria-label', `${SECTION_TITLES[section]}: выполнено ${done} из ${total}`);

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = SECTION_TITLES[section];

  const count = document.createElement('span');
  count.className = 'subhead__count';
  count.textContent = `${done} / ${total}`;

  row.append(label, count);

  // закрытая секция помечается галочкой — видно, что блок пройден целиком
  if (complete) {
    const tick = document.createElement('span');
    tick.className = 'subhead__tick';
    tick.textContent = '✓';
    tick.setAttribute('aria-hidden', 'true');
    row.append(tick);
  }

  return row;
}

function renderRow(item, index, isNext) {
  const row = document.createElement('article');
  row.id = `row-${item.id}`; // якорь для «подтянуть следующее наверх»
  const menuOpen = openMenuId === item.id;
  row.className = `row${item.done ? ' is-done' : ''}${isNext ? ' is-next' : ''}`;

  const mark = actionButton('toggle', item.id, item.done ? '✓' : '', {
    class: 'row__mark',
    pressed: item.done,
    label: `${item.done ? 'Снять отметку с' : 'Отметить выполненным'}: ${item.name}`,
  });

  const text = document.createElement('div');
  text.className = 'row__text';

  const name = document.createElement('p');
  name.className = 'row__name';
  name.textContent = item.name;

  const sub = document.createElement('p');
  sub.className = 'row__sub';
  sub.textContent = paramsText(item);

  text.append(name, sub);

  const actions = document.createElement('div');
  actions.className = 'row__actions';

  // «Старт» — только там, где есть длительность подхода (упражнения на время)
  if (item.type === 'time') {
    actions.append(
      actionButton('start', item.id, 'Старт', {
        class: 'row__start',
        label: `Запустить таймер: ${item.name}`,
      }),
    );
  }

  actions.append(
    actionButton('menu', item.id, '⋯', {
      class: 'row__more',
      label: `${menuOpen ? 'Закрыть' : 'Открыть'} действия: ${item.name}`,
      pressed: menuOpen,
    }),
  );

  const menu = document.createElement('div');
  menu.className = `row__menu${menuOpen ? ' is-open' : ''}`;
  menu.append(
    actionButton('up', item.id, '↑ Вверх', { class: 'row__menu-item', label: `Переместить вверх: ${item.name}`, disabled: index === 0 }),
    actionButton('down', item.id, '↓ Вниз', {
      class: 'row__menu-item',
      label: `Переместить вниз: ${item.name}`,
      disabled: index === state.exercises.length - 1,
    }),
    actionButton('edit', item.id, '✎ Изменить', { class: 'row__menu-item', label: `Изменить: ${item.name}` }),
    actionButton('remove', item.id, '✕ Удалить', { class: 'row__menu-item row__menu-item--danger', label: `Удалить: ${item.name}` }),
  );

  row.append(mark, text, actions, menu);
  return row;
}

function actionButton(action, id, text, { class: className = 'row__menu-item', label, pressed, disabled } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.dataset.action = action;
  button.dataset.id = id;
  if (label) {
    button.setAttribute('aria-label', label);
    button.title = label;
  }
  if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
  if (disabled) button.disabled = true;
  return button;
}

function renderSummary() {
  const total = state.exercises.length;
  const done = state.exercises.filter((item) => item.done).length;
  ui.progress.textContent = `${done} из ${total} выполнено`;

  const percent = total ? Math.round((done / total) * 100) : 0;
  ui.progressBar.value = percent;
  ui.progressBar.textContent = `${percent}%`;

  ui.kcalNote.textContent = `${KCAL_DISCLAIMER} Расчёт — на вашем устройстве.`;
}

function renderCurrent() {
  const next = state.exercises.find((item) => !item.done) ?? null;
  ui.currentName.textContent = next ? next.name : state.exercises.length ? 'Всё выполнено' : 'Список пуст';
  ui.currentParams.textContent = next ? paramsText(next) : '';

  if (state.weightKg === null) {
    ui.kcal.textContent = 'Укажите вес, чтобы видеть оценку расхода.';
    return;
  }
  const remaining = state.exercises.reduce(
    (sum, item) => (item.done ? sum : sum + (estimateKcal({ weightKg: state.weightKg, exercise: item }) ?? 0)),
    0,
  );
  const whole = estimateWorkoutKcal({ weightKg: state.weightKg, exercises: state.exercises }) ?? 0;
  ui.kcal.textContent = `Осталось ≈ ${remaining} ккал · весь комплекс ≈ ${whole} ккал`;
}

function setStatus(text) {
  ui.status.textContent = text;
}

// ---------- Действия со списком (делегирование) ----------

ui.list.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'show-done') {
    showDone = !showDone;
    render();
    return;
  }
  const { action, id } = button.dataset;
  const item = state.exercises.find((entry) => entry.id === id);
  if (!item) return;
  let pullToNext = false; // отметили выполненным → следующее упражнение поднимаем наверх
  openMenuId = null;

  switch (action) {
    case 'toggle':
      pullToNext = !item.done;
      state.exercises = toggleDone(state.exercises, id);
      openMenuId = null;
      setStatus(item.done ? `Снята отметка: ${item.name}` : `Отмечено выполненным: ${item.name}`);
      break;
    case 'menu':
      openMenuId = openMenuId === id ? null : id;
      render();
      return;
    case 'up':
    case 'down':
      stopTimerForExercise(id);
      state.exercises = moveExercise(state.exercises, id, action === 'up' ? -1 : 1);
      break;
    case 'edit':
      startEdit(item);
      openSheet();
      return;
    case 'remove':
      if (!confirm(`Удалить «${item.name}» из комплекса?`)) return;
      stopTimerForExercise(id);
      state.exercises = removeExercise(state.exercises, id);
      if (editingId === id) resetForm();
      setStatus(`Удалено: ${item.name}`);
      break;
    case 'start':
      startTimer(item);
      return;
    default:
      return;
  }
  save();
  const nextId = render();
  if (pullToNext) scrollToNext(nextId);
});

// Клик мимо меню «⋯» закрывает его
document.addEventListener('click', (event) => {
  if (!openMenuId) return;
  const button = event.target?.closest?.('button[data-action]');
  if (button?.dataset?.action === 'menu') return; // переключение обрабатывает список
  openMenuId = null;
  render();
});

// ---------- Нижний лист с формой ----------

function openSheet() {
  ui.sheet.classList.add('is-open');
  ui.sheet.setAttribute('aria-hidden', 'false');
  openMenuId = null;
  render();
  ui.name.focus();
}

function closeSheet() {
  ui.sheet.classList.remove('is-open');
  ui.sheet.setAttribute('aria-hidden', 'true');
  resetForm();
}

ui.addBtn.addEventListener('click', () => {
  resetForm();
  openSheet();
});
ui.sheetClose.addEventListener('click', closeSheet);
ui.sheet.addEventListener('click', (event) => {
  if (event.target === ui.sheet) closeSheet(); // клик по затемнению мимо панели
});

function syncFormFields() {
  const isTime = ui.type.value === 'time';
  ui.repsLabelText.textContent = isTime ? 'Подходов' : 'Повторений';
  ui.secondsField.hidden = !isTime;
}

function showFormError(text) {
  ui.formError.textContent = text;
  ui.formError.hidden = false;
}

function hideFormError() {
  ui.formError.hidden = true;
  ui.formError.textContent = '';
}

function resetForm() {
  editingId = null;
  ui.form.reset();
  ui.type.value = 'reps';
  ui.reps.value = '10';
  ui.seconds.value = '30';
  ui.section.value = 'main';
  ui.submit.textContent = 'Добавить';
  ui.cancel.hidden = true;
  ui.formTitle.textContent = 'Добавить упражнение';
  hideFormError();
  syncFormFields();
}

function startEdit(item) {
  editingId = item.id;
  ui.name.value = item.name;
  ui.type.value = item.type;
  ui.reps.value = String(item.reps);
  ui.seconds.value = String(item.seconds ?? 30);
  ui.section.value = item.section;
  ui.submit.textContent = 'Сохранить';
  ui.cancel.hidden = false;
  ui.formTitle.textContent = 'Редактировать упражнение';
  hideFormError();
  syncFormFields();
}

function readForm() {
  const name = ui.name.value.trim();
  const type = ui.type.value === 'time' ? 'time' : 'reps';
  const section = SECTIONS.includes(ui.section.value) ? ui.section.value : 'main';
  const reps = Number(ui.reps.value.trim());

  if (!name) return { error: 'Укажите название упражнения.' };
  if (ui.reps.value.trim() === '' || !Number.isInteger(reps) || reps <= 0) {
    return {
      error: type === 'time' ? 'Число подходов — целое число больше 0.' : 'Число повторений — целое число больше 0.',
    };
  }
  if (type === 'time') {
    const seconds = Number(ui.seconds.value.trim());
    if (ui.seconds.value.trim() === '' || !Number.isInteger(seconds) || seconds <= 0) {
      return { error: 'Для упражнения на время укажите целое число секунд в подходе (больше 0).' };
    }
    return { value: { name, type, reps, seconds, section } };
  }
  return { value: { name, type, reps, seconds: null, section } };
}

ui.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const result = readForm();
  if (result.error) {
    showFormError(result.error);
    return;
  }
  const wasEdit = Boolean(editingId);
  if (wasEdit) {
    stopTimerForExercise(editingId);
    state.exercises = updateExercise(state.exercises, editingId, result.value);
  } else {
    state.exercises = addExercise(state.exercises, result.value);
  }
  resetForm();
  save();
  render();
  closeSheet();
  setStatus(wasEdit ? 'Упражнение обновлено.' : `Добавлено: ${result.value.name}`);
});

ui.type.addEventListener('change', syncFormFields);
ui.cancel.addEventListener('click', () => {
  resetForm();
  closeSheet();
});

ui.resetProgress.addEventListener('click', () => {
  if (!confirm('Сбросить отметки о выполнении? Упражнения останутся.')) return;
  state.exercises = resetProgress(state.exercises);
  save();
  render();
  setStatus('Прогресс сброшен.');
});

ui.resetWorkout.addEventListener('click', () => {
  if (!confirm('Вернуть стартовый комплекс? Текущий список и отметки будут потеряны.')) return;
  stopTimer();
  state.exercises = cloneWorkout(DEFAULT_WORKOUT);
  save();
  render();
  closeSheet();
  setStatus('Восстановлен стартовый комплекс.');
});

ui.finish.addEventListener('click', () => {
  stopTimer();
  const total = state.exercises.length;
  const done = state.exercises.filter((item) => item.done).length;
  const kcal = estimateWorkoutKcal({ weightKg: state.weightKg, exercises: state.exercises });
  const kcalTail = kcal === null ? '' : ` · ≈ ${kcal} ккал`;
  if (total && done === total) {
    showBanner('Тренировка завершена', 2600);
    setStatus(`Все ${total} упражнений выполнены${kcalTail}. Вернуть список — кнопка «Вернуть стартовый комплекс» в форме.`);
  } else {
    showBanner(`Сделано ${done} из ${total}`, 2200);
    setStatus(`Тренировка завершена: ${done} из ${total} выполнено${kcalTail}.`);
  }
  render();
});

ui.weight.addEventListener('input', () => {
  const raw = ui.weight.value.trim();
  const value = Number(raw);
  state.weightKg = raw !== '' && Number.isFinite(value) && value > 0 ? value : null;
  save();
  render();
});

// ---------- Звук (WebAudio, без внешних файлов) ----------

let audioCtx = null;

function ensureAudio() {
  if (!state.soundOn) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function tone({ freq, ms = 120, gain = 0.15, delay = 0 }) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const end = start + ms / 1000;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(end + 0.02);
}

const SOUNDS = {
  tick: () => tone({ freq: 1000, ms: 30, gain: 0.05 }),
  // delay — сдвиг начала: «догоняющую» серию предупреждений слышно отдельными сигналами
  leadIn: (delay = 0) => tone({ freq: 880, ms: 160, gain: 0.2, delay }),
  setDone: () => {
    tone({ freq: 660, ms: 180, gain: 0.2 });
    tone({ freq: 990, ms: 220, gain: 0.2, delay: 0.2 });
  },
  finish: () => {
    [523, 659, 784].forEach((freq, index) => tone({ freq, ms: 260, gain: 0.3, delay: index * 0.22 }));
  },
};

function beep(kind, delay = 0) {
  if (!state.soundOn) return;
  SOUNDS[kind]?.(delay);
}

const unlockAudio = () => {
  if (state.soundOn) ensureAudio();
};
document.addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });

function updateSoundButton() {
  ui.sound.textContent = state.soundOn ? 'звук: вкл' : 'звук: выкл';
  ui.sound.setAttribute('aria-pressed', String(state.soundOn));
}

ui.sound.addEventListener('click', () => {
  state.soundOn = !state.soundOn;
  if (state.soundOn) {
    ensureAudio();
    SOUNDS.tick();
  }
  updateSoundButton();
  save();
  setStatus(state.soundOn ? 'Звук включён.' : 'Звук выключен — сигналы показываются на экране.');
});

// ---------- Визуальные сигналы ----------

function replay(node, className) {
  if (!node) return;
  node.classList.remove(className);
  void node.offsetWidth; // перезапуск CSS-анимации
  node.classList.add(className);
}

let bannerTimer = 0;
function showBanner(text, ms = 1800) {
  ui.banner.textContent = text;
  ui.banner.classList.add('is-visible', 'is-pulse');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => ui.banner.classList.remove('is-visible', 'is-pulse'), ms);
}

// ---------- Wake Lock ----------

let wakeNoticeShown = false;

function notifyWakeIssue(text) {
  if (wakeNoticeShown) return;
  wakeNoticeShown = true;
  queueMicrotask(() => setStatus(text));
}

async function requestWakeLock() {
  if (!timerActive()) return;
  if (!('wakeLock' in navigator)) {
    notifyWakeIssue('Браузер не поддерживает блокировку экрана — отключите автоблокировку вручную.');
    return;
  }
  if (timer.wakeLock) return;
  try {
    timer.wakeLock = await navigator.wakeLock.request('screen');
    timer.wakeLock.addEventListener('release', () => {
      timer.wakeLock = null;
    });
    ui.wake.textContent = 'Экран удерживается от автоблокировки.';
  } catch {
    timer.wakeLock = null;
    notifyWakeIssue('Не удалось удержать экран включённым — он может погаснуть.');
  }
}

function releaseWakeLock() {
  if (timer.wakeLock) {
    timer.wakeLock.release().catch(() => {});
    timer.wakeLock = null;
  }
  ui.wake.textContent = '';
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // фоновое время не засчитываем: сброс отметки кадра — отсчёт продолжится с места ухода
  timer.lastTs = 0;
  requestWakeLock();
});

// ---------- Таймер (единственный активный; отсчёт только через createTimer) ----------

const timer = {
  ctrl: null,
  exerciseId: null,
  rafId: 0,
  lastTs: 0,
  lastMark: null,
  leadInSent: 0,
  prevPhase: 'idle',
  wakeLock: null,
};

const timerActive = () => !!timer.ctrl && ['leadin', 'work'].includes(timer.ctrl.state().phase);

function stopRaf() {
  if (timer.rafId) cancelAnimationFrame(timer.rafId);
  timer.rafId = 0;
}

function startRaf() {
  stopRaf();
  timer.lastTs = 0;
  timer.rafId = requestAnimationFrame(frame);
}

function frame(ts) {
  if (!timer.ctrl) return;
  if (!timer.lastTs) {
    timer.lastTs = ts;
    timer.rafId = requestAnimationFrame(frame);
    return;
  }
  let dt = (ts - timer.lastTs) / 1000;
  timer.lastTs = ts;
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  if (dt > MAX_DT) dt = MAX_DT;

  const leadInBefore = timer.prevPhase === 'leadin' ? timer.ctrl.state().remaining : null;
  const snapshot = timer.ctrl.tick(dt);
  handleSnapshot(snapshot, leadInBefore);
  if (snapshot.phase === 'setDone' || snapshot.phase === 'finished' || snapshot.phase === 'idle') {
    stopRaf();
    return;
  }
  timer.rafId = requestAnimationFrame(frame);
}

function startTimer(item) {
  stopTimer();
  timer.ctrl = createTimer({ sets: item.reps, seconds: item.seconds, leadIn: LEAD_IN });
  timer.exerciseId = item.id;
  timer.prevPhase = 'idle';
  timer.lastMark = null;
  timer.leadInSent = 0;
  ui.timerTitle.textContent = `Таймер: ${item.name}`;
  ui.timer.hidden = false;
  ui.timerNext.hidden = true;
  ui.timerDone.hidden = true;
  ui.timerPause.hidden = false;
  ui.timerPause.textContent = 'Пауза';
  handleSnapshot(timer.ctrl.start());
  startRaf();
  requestWakeLock();
  setStatus(`Таймер запущен: ${item.name}. Приготовьтесь.`);
}

function stopTimer() {
  if (!timer.ctrl) return;
  stopRaf();
  timer.ctrl.reset();
  releaseWakeLock();
  timer.ctrl = null;
  timer.exerciseId = null;
  timer.prevPhase = 'idle';
  timer.lastMark = null;
  timer.leadInSent = 0;
  ui.timer.hidden = true;
  ui.timerBig.textContent = '';
  ui.timerPhase.textContent = '';
  ui.timerSets.textContent = '';
}

function stopTimerForExercise(id) {
  if (timer.exerciseId === id) {
    stopTimer();
    setStatus('Таймер остановлен: упражнение изменено.');
  }
}

// Сколько предупреждений задолжали — столько и подаём: метку можно проскочить большим dt,
// а сигналы терять нельзя (ТЗ: не меньше трёх перед подходом).
function emitLeadInSignals(due, snapshot) {
  let burst = 0;
  while (timer.leadInSent < due) {
    timer.leadInSent += 1;
    ui.timerBig.textContent = String(LEAD_IN - timer.leadInSent + 1);
    ui.timerPhase.textContent = `Приготовьтесь: подход ${snapshot.setIndex + 1} из ${snapshot.totalSets}`;
    replay(ui.timerBig, 'is-beat');
    beep('leadIn', burst * 0.18);
    burst += 1;
  }
}

function handleSnapshot(snapshot, leadInBefore = null) {
  const changedPhase = snapshot.phase !== timer.prevPhase;
  const phase = snapshot.phase;

  if (leadInBefore !== null && phase !== 'leadin') emitLeadInSignals(LEAD_IN, snapshot);

  if (phase === 'leadin') {
    emitLeadInSignals(Math.min(LEAD_IN, LEAD_IN - Math.ceil(snapshot.remaining) + 1), snapshot);
  } else if (phase === 'work') {
    const mark = Math.max(0, Math.ceil(snapshot.remaining));
    if (changedPhase) {
      timer.lastMark = mark;
      ui.timerBig.textContent = String(mark);
    } else if (mark !== timer.lastMark) {
      timer.lastMark = mark;
      ui.timerBig.textContent = String(mark);
      replay(ui.timerBig, 'is-beat');
      replay(ui.tickDot, 'is-on');
      beep('tick');
    }
    ui.timerPhase.textContent = 'Работа';
  } else if (phase === 'setDone') {
    if (changedPhase) {
      ui.timerBig.textContent = '✓';
      ui.timerPhase.textContent = `Подход ${snapshot.setIndex + 1} из ${snapshot.totalSets} выполнен`;
      ui.timerNext.hidden = false;
      ui.timerPause.hidden = true;
      beep('setDone');
      showBanner(`Подход ${snapshot.setIndex + 1} из ${snapshot.totalSets} выполнен`);
      releaseWakeLock();
      setStatus('Подход выполнен. Нажмите «Следующий подход», чтобы продолжить.');
    }
  } else if (phase === 'finished') {
    if (changedPhase || snapshot.justFinished) {
      ui.timerBig.textContent = '✓';
      ui.timerPhase.textContent = 'Упражнение завершено';
      ui.timerNext.hidden = true;
      ui.timerPause.hidden = true;
      ui.timerDone.hidden = false;
      beep('finish');
      showBanner('Упражнение завершено', 2600);
      releaseWakeLock();
      setStatus('Все подходы выполнены. Отметьте упражнение выполненным.');
    }
  }

  if (snapshot.totalSets > 0) {
    ui.timerSets.textContent = `Подход ${Math.min(snapshot.setIndex + 1, snapshot.totalSets)} из ${snapshot.totalSets}`;
  }
  timer.prevPhase = phase;
}

ui.timerPause.addEventListener('click', () => {
  if (!timer.ctrl) return;
  const snapshot = timer.ctrl.state();
  if (snapshot.paused) {
    timer.ctrl.resume();
    ui.timerPause.textContent = 'Пауза';
    requestWakeLock();
    setStatus('Продолжаем.');
  } else {
    timer.ctrl.pause();
    ui.timerPause.textContent = 'Продолжить';
    releaseWakeLock();
    setStatus('Пауза.');
  }
});

ui.timerNext.addEventListener('click', () => {
  if (!timer.ctrl) return;
  timer.leadInSent = 0; // новый подход — снова три предупреждения
  handleSnapshot(timer.ctrl.next());
  startRaf();
  requestWakeLock();
  setStatus('Следующий подход: приготовьтесь.');
});

ui.timerStop.addEventListener('click', () => {
  stopTimer();
  setStatus('Таймер остановлен.');
});

ui.timerDone.addEventListener('click', () => {
  const id = timer.exerciseId;
  const item = state.exercises.find((entry) => entry.id === id);
  if (item && !item.done) state.exercises = toggleDone(state.exercises, id);
  stopTimer();
  save();
  const nextId = render();
  if (item) scrollToNext(nextId);
  setStatus(item ? `Отмечено выполненным: ${item.name}` : 'Готово.');
});

// ---------- Инициализация ----------

function init() {
  load();
  ui.weight.value = state.weightKg === null ? '' : String(state.weightKg);
  updateSoundButton();
  syncFormFields();
  syncScrollOffset();
  if (typeof window !== 'undefined') window.addEventListener?.('resize', syncScrollOffset);
  render();
}

init();
