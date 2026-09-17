// UI-слой: DOM, localStorage, WebAudio, Wake Lock.
// Вся логика комплекта и таймера — в ./logic.js (чистое ядро); здесь только ввод/показ.
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
} from './logic.js';

const STORAGE_KEY = 'workout.v1';
const LEAD_IN = 3; // предупреждающих сигналов перед подходом (ТЗ: не меньше 3)
const SECTION_TITLES = { warmup: 'Разминка', main: 'Основная часть', abs: 'Пресс' };
const SECTIONS = Object.keys(SECTION_TITLES);

// Тема оформления: «светлая» по умолчанию (на телефоне тёмная читается хуже), плюс тёмная и авто.
const THEMES = ['light', 'dark', 'auto'];
const THEME_LABELS = { light: '☀ светлая', dark: '☾ тёмная', auto: '◐ авто' };
const THEME_COLORS = { light: '#f1ede6', dark: '#070a10' };

// ponytail: верхняя граница dt на один кадр. В фоне rAF не тикает, по возвращении dt
// реален, но может быть космическим (сон устройства). 90 с — «догон» обычного троттлинга
// без телепорта через всю тренировку; при необходимости граница поднимается одной константой.
const MAX_DT = 90;

const $ = (id) => document.getElementById(id);
const ui = {
  weight: $('weightInput'),
  sound: $('soundToggle'),
  theme: $('themeToggle'),
  themeColor: $('themeColor'),
  statusBar: $('statusBarStyle'),
  progress: $('progressText'),
  progressBar: $('progressBar'),
  progressPercent: $('progressPercent'),
  kcal: $('workoutKcal'),
  kcalMetric: $('kcalMetric'),
  kcalNote: $('kcalDisclaimer'),
  wake: $('wakeStatus'),
  status: $('status'),
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
  banner: $('banner'),
};

// ponytail: объявлено ДО использования — const в TDZ, вызов выше объявления роняет весь модуль.
const cloneWorkout = (list) => list.map((item) => ({ ...item }));

let state = { exercises: cloneWorkout(DEFAULT_WORKOUT), weightKg: null, soundOn: true, theme: 'light' };
let editingId = null;
let showDone = false; // «Показать выполненные»: скрытые строки можно вернуть и снять отметку
let theme = 'light'; // активная настройка темы: light | dark | auto

// ---------- Сохранение / восстановление (localStorage — единственный источник данных) ----------

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // приватный режим или переполнение квоты — тренировка продолжает работать в памяти
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

  // trust boundary: данные из localStorage могли быть кем угодно испорчены
  const exercises = Array.isArray(data.exercises)
    ? data.exercises.filter(isValidExercise).map(normalizeExercise)
    : [];
  if (exercises.length) state.exercises = exercises;

  const weight = Number(data.weightKg);
  state.weightKg = Number.isFinite(weight) && weight > 0 ? weight : null;
  state.soundOn = data.soundOn !== false;
  state.theme = THEMES.includes(data.theme) ? data.theme : 'light';
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

// ---------- Текст параметров ----------

function plural(n, one, few, many) {
  const t10 = n % 10;
  const t100 = n % 100;
  if (t10 === 1 && t100 !== 11) return one;
  if (t10 >= 2 && t10 <= 4 && (t100 < 12 || t100 > 14)) return few;
  return many;
}

function paramsText(item) {
  if (item.type === 'time') {
    return `${item.reps} ${plural(item.reps, 'подход', 'подхода', 'подходов')} × ${item.seconds} сек`;
  }
  const base = `${item.reps} ${plural(item.reps, 'повторение', 'повторения', 'повторений')}`;
  return item.note ? `${base} — ${item.note}` : base;
}

// ---------- Рендер списка ----------

function render() {
  ui.list.textContent = '';
  const pending = state.exercises.filter((item) => !item.done);
  const nextId = pending[0]?.id ?? null;
  const doneItems = [];
  let currentSection = null;

  state.exercises.forEach((item, index) => {
    if (item.section !== currentSection) {
      currentSection = item.section;
      ui.list.append(renderSectionTitle(item.section, index));
    }
    if (item.done) {
      doneItems.push({ item, index });
      return; // выполненные с экрана убираем: список показывает только то, что осталось сделать
    }
    ui.list.append(renderExercise(item, index, item.id === nextId));
  });

  if (!pending.length && state.exercises.length) ui.list.append(renderAllDone());
  // отметку можно снять: выполненные прячутся, но по кнопке возвращаются на экран
  if (doneItems.length) ui.list.append(renderDoneToggle(doneItems.length));
  if (showDone) doneItems.forEach(({ item, index }) => ui.list.append(renderExercise(item, index, false)));

  renderSummary();
  return nextId; // нужен, чтобы подтянуть следующее упражнение к верху страницы
}

// Когда всё выполнено, список пуст — объясняем это и подсказываем, где сбросить отметки
function renderAllDone() {
  const box = document.createElement('p');
  box.className = 'empty-state';
  box.textContent = 'Все упражнения выполнены. «↺ Сбросить отметки» — под списком.';
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

// Отступ прокрутки: на широком экране шапка липкая и не должна накрывать подтянутую карточку.
// Считаем высоту по факту, а не константой — шапка меняет высоту вместе с содержимым.
function syncScrollOffset() {
  const root = document.documentElement;
  if (!root?.style || typeof document.querySelector !== 'function') return;
  const header = document.querySelector('.topbar');
  if (!header) return;
  const sticky = getComputedStyle(header).position === 'sticky';
  const gap = sticky ? Math.round(header.getBoundingClientRect().height) + 12 : 14;
  root.style.setProperty('--scroll-offset', `${gap}px`);
}

// Заголовок секции: название + счётчик выполненных внутри этого блока.
// Считаем только подряд идущие упражнения: одна секция может встречаться в списке дважды
// (например, упражнения на пресс добавлены в конец после основной части).
function renderSectionTitle(section, fromIndex) {
  let total = 0;
  let done = 0;
  for (let i = fromIndex; i < state.exercises.length; i += 1) {
    if (state.exercises[i].section !== section) break;
    total += 1;
    if (state.exercises[i].done) done += 1;
  }
  const complete = total > 0 && done === total;

  const heading = document.createElement('h3');
  heading.className = `section-title section-title--${section}${complete ? ' is-complete' : ''}`;
  if (complete) heading.setAttribute('aria-label', `${SECTION_TITLES[section]}: выполнено ${done} из ${total}`);

  const label = document.createElement('span');
  label.className = 'section-title__label';
  label.textContent = SECTION_TITLES[section];

  const count = document.createElement('span');
  count.className = 'section-title__count';
  count.textContent = `${done} / ${total}`;

  heading.append(label, count);

  // закрытая секция помечается галочкой — видно, что блок пройден целиком
  if (complete) {
    const tick = document.createElement('span');
    tick.className = 'section-title__tick';
    tick.textContent = '✓';
    tick.setAttribute('aria-hidden', 'true');
    heading.append(tick);
  }

  return heading;
}

function renderExercise(item, index, isNext) {
  const card = document.createElement('article');
  card.id = `row-${item.id}`; // якорь для «подтянуть следующее наверх»
  card.className = `exercise exercise--${item.section}${item.done ? ' is-done' : ''}${isNext ? ' is-next' : ''}`;

  const num = document.createElement('span');
  num.className = 'exercise__num';
  num.textContent = String(index + 1).padStart(2, '0');

  const body = document.createElement('div');
  body.className = 'exercise__body';

  const name = document.createElement('h4');
  name.className = 'exercise__name';
  name.textContent = item.name;

  const params = document.createElement('p');
  params.className = 'exercise__params';
  params.textContent = paramsText(item);

  body.append(name, params);

  // метки состояния отдельной строкой: бейджи не ломают набор названия и переносятся целиком.
  // «Выполнено» бейджем не дублируем — состояние уже видно по рельсу, зачёркиванию и кнопке.
  const flags = document.createElement('div');
  flags.className = 'exercise__flags';
  if (isNext) flags.append(badge('Следующее', 'badge--next'));

  const meta = document.createElement('div');
  meta.className = 'exercise__meta';

  // тип «повторения» виден из строки параметров — чип ставим только для упражнений на время
  if (item.type === 'time') {
    const kind = document.createElement('span');
    kind.className = 'chip';
    kind.textContent = 'на время';
    meta.append(kind);
  }

  const kcal = itemKcal(item);
  if (kcal !== null) {
    const kcalChip = document.createElement('span');
    kcalChip.className = 'chip chip--kcal';
    kcalChip.textContent = `≈ ${kcal} ккал`;
    kcalChip.title = 'Приблизительная оценка расхода';
    meta.append(kcalChip);
  }

  body.append(flags, meta);

  const actions = document.createElement('div');
  actions.className = 'exercise__actions';
  actions.append(
    actionButton('toggle', item.id, item.done ? '✓ Выполнено' : 'Отметить', {
      class: 'exercise__toggle',
      pressed: item.done,
      label: `${item.done ? 'Снять отметку с' : 'Отметить выполненным'}: ${item.name}`,
    }),
  );

  if (item.type === 'time') {
    actions.append(
      actionButton('start', item.id, '▶ Старт', {
        class: 'btn btn--primary',
        label: `Запустить таймер: ${item.name}`,
      }),
    );
  }

  // иконочные действия в отдельной группе: при узком экране переносятся целиком
  const tools = document.createElement('div');
  tools.className = 'exercise__tools';
  tools.append(
    actionButton('up', item.id, '↑', { class: 'btn btn--icon btn--ghost', label: `Переместить вверх: ${item.name}`, disabled: index === 0 }),
    actionButton('down', item.id, '↓', {
      class: 'btn btn--icon btn--ghost',
      label: `Переместить вниз: ${item.name}`,
      disabled: index === state.exercises.length - 1,
    }),
    actionButton('edit', item.id, '✎', { class: 'btn btn--icon btn--ghost', label: `Изменить: ${item.name}` }),
    actionButton('remove', item.id, '✕', { class: 'btn btn--icon btn--danger', label: `Удалить: ${item.name}` }),
  );
  actions.append(tools);

  card.append(num, body, actions);
  return card;
}

function badge(text, extra = '') {
  const span = document.createElement('span');
  span.className = `badge${extra ? ' ' + extra : ''}`;
  span.textContent = text;
  return span;
}

function actionButton(action, id, text, { class: className = 'btn', label, pressed, disabled } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.dataset.action = action;
  button.dataset.id = id;
  if (label) {
    // подпись и всплывающая подсказка: иконочным кнопкам без текста без них не обойтись
    button.setAttribute('aria-label', label);
    button.title = label;
  }
  if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
  if (disabled) button.disabled = true;
  return button;
}

// ---------- Сводка и калории ----------

function renderSummary() {
  const total = state.exercises.length;
  const done = state.exercises.filter((item) => item.done).length;
  ui.progress.textContent = `Выполнено ${done} из ${total}`;

  // прогресс-бар и процент — одна и та же величина, показанная полосой и числом
  const percent = total ? Math.round((done / total) * 100) : 0;
  ui.progressBar.value = percent;
  ui.progressBar.textContent = `${percent}%`;
  ui.progressPercent.textContent = `${percent}%`;

  const totalKcal = estimateWorkoutKcal({ weightKg: state.weightKg, exercises: state.exercises });
  const hasKcal = totalKcal !== null;
  ui.kcal.textContent = hasKcal ? `≈ ${totalKcal} ккал за тренировку` : 'Укажите вес — покажу оценку';
  // пустое состояние помечаем классом: подсказка тише, готовая цифра — крупнее и ярче
  if (hasKcal) ui.kcalMetric.classList.remove('is-empty');
  else ui.kcalMetric.classList.add('is-empty');
  ui.kcalNote.textContent = `${KCAL_DISCLAIMER} Расчёт — на вашем устройстве.`;
}

function itemKcal(item) {
  if (state.weightKg === null) return null;
  return estimateKcal({ weightKg: state.weightKg, exercise: item });
}

function setStatus(text) {
  ui.status.textContent = text;
}

// ---------- Действия над списком (делегирование с карточек) ----------

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

  switch (action) {
    case 'toggle':
      pullToNext = !item.done;
      state.exercises = toggleDone(state.exercises, id);
      setStatus(item.done ? `Снята отметка: ${item.name}` : `Отмечено выполненным: ${item.name}`);
      break;
    case 'up':
    case 'down':
      stopTimerForExercise(id); // порядок меняется — активный отсчёт для этого пункта сбит
      state.exercises = moveExercise(state.exercises, id, action === 'up' ? -1 : 1);
      break;
    case 'edit':
      startEdit(item);
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

// ---------- Форма CRUD ----------

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
  ui.name.focus();
}

function readForm() {
  const name = ui.name.value.trim();
  const type = ui.type.value === 'time' ? 'time' : 'reps';
  const section = SECTIONS.includes(ui.section.value) ? ui.section.value : 'main';
  const repsRaw = ui.reps.value.trim();
  const reps = Number(repsRaw);

  if (!name) return { error: 'Укажите название упражнения.' };
  if (repsRaw === '' || !Number.isInteger(reps) || reps <= 0) {
    return {
      error: type === 'time'
        ? 'Число подходов — целое число больше 0.'
        : 'Число повторений — целое число больше 0.',
    };
  }
  if (type === 'time') {
    const secondsRaw = ui.seconds.value.trim();
    const seconds = Number(secondsRaw);
    if (secondsRaw === '' || !Number.isInteger(seconds) || seconds <= 0) {
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
    stopTimerForExercise(editingId); // параметры подхода изменились
    state.exercises = updateExercise(state.exercises, editingId, result.value);
  } else {
    state.exercises = addExercise(state.exercises, result.value);
  }
  resetForm();
  save();
  render();
  setStatus(wasEdit ? 'Упражнение обновлено.' : `Добавлено: ${result.value.name}`);
});

ui.type.addEventListener('change', syncFormFields);
ui.cancel.addEventListener('click', resetForm);

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
  setStatus('Восстановлен стартовый комплекс.');
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
  tick: () => tone({ freq: 1000, ms: 30, gain: 0.05 }), // тик раз в секунду, тихий
  // delay — сдвиг начала: «догоняющую» серию предупреждений слышно отдельными сигналами,
  // а не одним слипшимся.
  leadIn: (delay = 0) => tone({ freq: 880, ms: 160, gain: 0.2, delay }), // заметнее тика
  setDone: () => {
    tone({ freq: 660, ms: 180, gain: 0.2 });
    tone({ freq: 990, ms: 220, gain: 0.2, delay: 0.2 });
  },
  finish: () => {
    // финал: тройная восходящая последовательность, заметно громче и длиннее
    [523, 659, 784].forEach((freq, index) => tone({ freq, ms: 260, gain: 0.3, delay: index * 0.22 }));
  },
};

function beep(kind, delay = 0) {
  if (!state.soundOn) return;
  SOUNDS[kind]?.(delay);
}

// AudioContext создаётся/возобновляется по первому пользовательскому жесту
const unlockAudio = () => {
  if (state.soundOn) ensureAudio();
};
document.addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });

function updateSoundButton() {
  ui.sound.textContent = state.soundOn ? 'Звук: вкл' : 'Звук: выкл';
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

// ---------- Тема оформления ----------
// Вся палитра — переменные CSS: переключение сводится к атрибуту data-theme на <html>.
// «Авто» разрешается по системной настройке; остальное хранится в том же localStorage.

function resolveTheme(preference) {
  if (preference !== 'auto') return preference;
  const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? 'dark' : 'light';
}

function applyTheme(preference) {
  theme = THEMES.includes(preference) ? preference : 'light';
  state.theme = theme;
  const resolved = resolveTheme(theme);
  // jsdom-заглушки в проверках не имеют documentElement — тихо пропускаем
  const root = document.documentElement;
  if (root) root.dataset.theme = resolved;
  ui.themeColor?.setAttribute('content', THEME_COLORS[resolved]);
  // iOS: в светлой теме полоса статуса с тёмным текстом, в тёмной — прозрачная поверх контента
  ui.statusBar?.setAttribute('content', resolved === 'dark' ? 'black-translucent' : 'default');
  ui.theme.textContent = `Тема: ${THEME_LABELS[theme]}`;
  ui.theme.setAttribute('aria-label', `Тема оформления: ${THEME_LABELS[theme]}. Нажмите, чтобы переключить.`);
}

ui.theme.addEventListener('click', () => {
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  applyTheme(next);
  save();
  setStatus(`Тема оформления: ${THEME_LABELS[next]}.`);
});

// Система сменила схему, а выбрано «авто» — перекрашиваемся сразу
if (typeof matchMedia === 'function') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (theme === 'auto') applyTheme('auto');
  });
}

// ---------- Визуальные сигналы (дублируют звук и работают без него) ----------

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

// Одно сообщение за сессию: иначе при каждом старте таймера сыпался бы один и тот же текст.
let wakeNoticeShown = false;

// Одно сообщение за сессию И строго после синхронного кода вызывающего: иначе его
// setStatus («Таймер запущен…») затирает текст в том же такте и пользователь его не увидит.
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
    notifyWakeIssue('Браузер отклонил блокировку экрана — отключите автоблокировку вручную.');
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
  // фон/возврат: rAF молчал, и «слепое» фоновое время засчитывать нельзя — иначе таймер
  // телепортом проматывает подход вместе с предупреждениями. Сброс отметки кадра:
  // следующий кадр только выставит новую базу, отсчёт продолжится с места ухода.
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
  leadInSent: 0, // сколько предупреждений уже подано в текущем leadin (гарантия «не меньше трёх»)
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

  // остаток подготовки ДО тика: если кадр перешагнёт его целиком, сигналы терять нельзя
  const leadInBefore = timer.prevPhase === 'leadin' ? timer.ctrl.state().remaining : null;
  const snapshot = timer.ctrl.tick(dt);
  handleSnapshot(snapshot, leadInBefore);
  if (snapshot.phase === 'setDone' || snapshot.phase === 'finished' || snapshot.phase === 'idle') {
    stopRaf(); // кадры не нужны: следующий подход запускает пользователь / таймер завершён
    return;
  }
  timer.rafId = requestAnimationFrame(frame);
}

function startTimer(item) {
  stopTimer(); // одновременно активен только один таймер
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

// Предупреждения перед подходом подаём не «по смене метки» (большой dt — например, возврат
// на вкладку — метку проскакивает и сигналов недодаётся), а по числу уже поданных: сколько
// задолжали, столько и звучит. Больше LEAD_IN за подход быть не может.
// ponytail: добор идёт одной серией в том же кадре (шаг 180 мс); отдельных таймеров под
// «отложенные» сигналы нет — при уходе вкладки в фон серия не доиграет.
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

  // кадр перешагнул остаток подготовки целиком (большой dt) — добираем сигналы, а не молчим.
  // Ветку своей фазы ниже это не отменяет: иначе работа стартует без метки и без lastMark.
  if (leadInBefore !== null && phase !== 'leadin') emitLeadInSignals(LEAD_IN, snapshot);

  if (phase === 'leadin') {
    // метки 3, 2, 1: к этому моменту должны были прозвучать первые LEAD_IN - ceil(remaining) + 1
    emitLeadInSignals(Math.min(LEAD_IN, LEAD_IN - Math.ceil(snapshot.remaining) + 1), snapshot);
  } else if (phase === 'work') {
    const mark = Math.max(0, Math.ceil(snapshot.remaining));
    if (changedPhase) {
      timer.lastMark = mark;
      ui.timerBig.textContent = String(mark);
    } else if (mark !== timer.lastMark) {
      timer.lastMark = mark;
      ui.timerBig.textContent = String(mark);
      replay(ui.timerBig, 'is-beat'); // визуальный тик — работает и при выключенном звуке
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
      beep('finish'); // финальный сигнал — тройная последовательность
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
  handleSnapshot(timer.ctrl.next()); // next() -> leadin -> work, автозапуск остаётся запрещён
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
  applyTheme(state.theme);
  syncFormFields();
  syncScrollOffset();
  if (typeof window !== 'undefined') window.addEventListener?.('resize', syncScrollOffset);
  render();
}

init();
