// Игровой цикл и связка с сервером.
//
// Клиент крутит тик (клики, доход в секунду, кринж, таймеры событий), сервер
// владеет правилами и данными: цены улучшений, выбор события, оффлайн-доход и
// сохранение в SQLite.

import { api } from './api.js';
import { renderCheremsha } from './cheremsha.js';
import * as ui from './ui.js';

const app = {
  state: null,        // снимок с сервера (улучшения, этапы, витрина, конфиг)
  cfg: null,
  d: null,            // derived: сила клика, пассив, механики
  hype: 0,
  total: 0,
  subs: 0,
  cringe: 0,
  clicks: 0,
  buffs: [],          // [{ src, kind, mult, until }]
  event: null,        // активное событие
  eventEndsAt: 0,
  nextEventAt: 0,
  adReadyAt: 0,
  lastClickAt: 0,
  lastTick: 0,
  dirty: false,
  busy: false,
};

// ------------------------------------------------------------------ буффы
function multOf(kind) {
  const now = performance.now();
  let m = 1;
  for (const b of app.buffs) {
    if (b.until > now && (b.kind === kind || b.kind === 'all')) m *= b.mult;
  }
  return m;
}

function addBuff(src, kind, mult, seconds) {
  app.buffs = app.buffs.filter((b) => b.src !== src);
  app.buffs.push({ src, kind, mult, until: performance.now() + seconds * 1000 });
}

function cringePenalty() {
  const c = app.cfg;
  const over = Math.max(0, app.cringe - c.cringe_safe) / (c.cringe_max - c.cringe_safe);
  return 1 - over * c.cringe_penalty_at_max;
}

function passiveRate() {
  return app.d.passive * multOf('passive') * multOf('all') * cringePenalty();
}

// --------------------------------------------------------------- игровой тик
function tick(now) {
  requestAnimationFrame(tick);
  if (!app.state) return;

  const dt = Math.min(0.25, (now - app.lastTick) / 1000);
  app.lastTick = now;
  const c = app.cfg;

  // доход в секунду
  const gain = passiveRate() * dt;
  if (gain > 0) {
    app.hype += gain;
    app.total += gain;
  }

  // подписчики набегают от производства, кринж их душит
  const subsFlow = gain * c.subs_per_hype
    * (1 - (app.cringe / c.cringe_max) * c.subs_cringe_block);
  app.subs += Math.max(0, subsFlow);

  // кринж: конвейер копит, живые клики сбивают (см. onClick)
  if (app.d.passive > 0) {
    app.cringe += c.cringe_per_passive * dt * app.d.cringe_mult;
  }
  app.cringe = Math.max(0, Math.min(c.cringe_max, app.cringe - c.cringe_decay * dt));

  // таймеры событий
  if (app.event && now >= app.eventEndsAt) endEvent();
  if (!app.event && now >= app.nextEventAt) rollEvent();
  if (app.event) ui.updateEventTimer((app.eventEndsAt - now) / 1000);

  drawHud();
  if (app.d.rhythm_mult) drawRhythm(now);
}

function drawHud() {
  const extras = [];
  if (app.d.crit_chance) extras.push(`крит ${Math.round(app.d.crit_chance * 100)}% ×${app.d.crit_mult}`);
  if (app.d.combo_every) extras.push(`каждый ${app.d.combo_every}-й ×${app.d.combo_mult}`);
  if (app.d.rhythm_mult) extras.push(`в такт ×${app.d.rhythm_mult.toFixed(1)}`);
  const boost = multOf('click') * multOf('all');
  if (boost > 1.001) extras.push(`буст ×${boost.toFixed(1)}`);

  ui.renderStats({
    hype: app.hype,
    rate: passiveRate(),
    subs: app.subs,
    cringe: app.cringe,
    clickPower: clickGain(false).base,
    extras,
  });
  ui.renderStage(app.state, app.subs);
}

// ------------------------------------------------------------------- ритм
function beatPhase(now) {
  const period = 60000 / app.d.rhythm_bpm;
  return (now % period) / period;
}

function drawRhythm(now) {
  const dot = document.querySelector('.rhythm-dot');
  if (!dot) return;
  const p = beatPhase(now);
  dot.classList.toggle('on', p < 0.16);
}

function inRhythm(now) {
  if (!app.d.rhythm_mult) return false;
  const p = beatPhase(now);
  return p < 0.14 || p > 0.86;
}

// -------------------------------------------------------------------- клик
function clickGain(apply) {
  const now = performance.now();
  let base = app.d.click_power * multOf('click') * multOf('all') * cringePenalty();
  let cls = '';
  let label = '';

  if (!apply) return { base, value: base, cls, label };

  let value = base;
  const nth = app.clicks + 1;
  if (app.d.combo_every && nth % app.d.combo_every === 0) {
    value *= app.d.combo_mult;
    cls = 'big';
    label = 'СЕРИЯ!';
  }
  if (inRhythm(now)) {
    value *= app.d.rhythm_mult;
    if (!cls) { cls = 'big'; label = 'В ТАКТ!'; }
  }
  if (Math.random() < app.d.crit_chance) {
    value *= app.d.crit_mult;
    cls = 'crit';
    label = 'ПЫЛЕСОС!';
  }
  return { base, value, cls, label };
}

function onClick(e) {
  if (!app.state) return;
  const now = performance.now();
  if (now - app.lastClickAt < app.cfg.click_cooldown_ms) return;
  app.lastClickAt = now;

  const { value, cls, label } = clickGain(true);
  app.clicks += 1;
  app.hype += value;
  app.total += value;
  app.subs += value * app.cfg.subs_per_hype * 0.5;
  app.cringe = Math.max(0, app.cringe - app.cfg.cringe_per_click);
  app.dirty = true;

  const btn = document.getElementById('cheremsha');
  btn.classList.remove('pop', 'crit');
  void btn.offsetWidth;
  btn.classList.add(cls === 'crit' ? 'crit' : 'pop');

  const box = document.querySelector('.clicker').getBoundingClientRect();
  const p = e.touches ? e.touches[0] : e;
  const x = (p.clientX ?? box.left + box.width / 2) - box.left;
  const y = (p.clientY ?? box.top + box.height / 2) - box.top;
  ui.floater(x, y, `${label ? `${label} ` : ''}+${ui.fmt.n(value)}`, cls);
}

// ------------------------------------------------------------------ события
async function rollEvent() {
  scheduleEvent();
  try {
    const res = await api.rollEvent(app.cringe);
    if (!res.event) return;
    applyEvent(res.event);
    refreshLog();
  } catch (e) { /* событие не критично */ }
}

function scheduleEvent() {
  const c = app.cfg;
  const gap = c.event_min_gap + Math.random() * (c.event_max_gap - c.event_min_gap);
  app.nextEventAt = performance.now() + gap * 1000;
}

function applyEvent(ev) {
  if (ev.instant_hype) {
    app.hype += ev.instant_hype;
    app.total += ev.instant_hype;
  }
  if (ev.subs_delta_pct) app.subs = Math.max(0, app.subs * (1 + ev.subs_delta_pct));
  if (ev.cringe_delta) {
    app.cringe = Math.max(0, Math.min(app.cfg.cringe_max, app.cringe + ev.cringe_delta));
  }
  app.dirty = true;

  const dur = ev.duration || 0;
  if (dur > 0) {
    if (ev.hype_mult !== undefined) addBuff(`ev:${ev.id}`, 'all', ev.hype_mult, dur);
    if (ev.click_mult !== undefined) addBuff(`ev:${ev.id}:c`, 'click', ev.click_mult, dur);
    if (ev.passive_mult !== undefined) addBuff(`ev:${ev.id}:p`, 'passive', ev.passive_mult, dur);
    app.event = ev;
    app.eventEndsAt = performance.now() + dur * 1000;
    ui.showEvent(ev, fixEvent);
  } else {
    // мгновенное событие — показываем баннер на 6 секунд без эффектов времени
    app.event = ev;
    app.eventEndsAt = performance.now() + 6000;
    ui.showEvent(ev, null);
  }
}

function endEvent() {
  if (app.event) {
    app.buffs = app.buffs.filter((b) => !b.src.startsWith(`ev:${app.event.id}`));
  }
  app.event = null;
  ui.hideEvent();
}

async function fixEvent(ev) {
  try {
    const res = await api.fixEvent(ev.id, app.hype);
    app.hype = Math.max(0, app.hype - res.cost);
    endEvent();
    refreshLog();
    ui.toast('Кризис закрыт');
  } catch (e) {
    ui.toast(e.message);
  }
}

// ------------------------------------------------------------------ покупки
async function buy(id) {
  if (app.busy) return;
  app.busy = true;
  try {
    await sync();
    const st = await api.buy(id, app.hype);
    adopt(st, false);
  } catch (e) {
    ui.toast(e.message);
  } finally {
    app.busy = false;
    renderAll();
  }
}

// ------------------------------------------------------------------ витрина
async function onShop(item) {
  try {
    const res = await api.shop(item.id);
    if (res.boost) return playAd(res.boost);
    ui.showMock(`${item.icon} ${item.name}`, res.message);
    refreshLog();
  } catch (e) {
    ui.toast(e.message);
  }
}

function playAd(boost) {
  const now = performance.now();
  if (now < app.adReadyAt) {
    ui.toast(`Следующий ролик через ${Math.ceil((app.adReadyAt - now) / 1000)} с`);
    return;
  }
  const modal = document.getElementById('adModal');
  const bar = document.getElementById('adBar');
  modal.hidden = false;
  bar.style.transition = 'none';
  bar.style.width = '0%';
  requestAnimationFrame(() => {
    bar.style.transition = 'width 5s linear';
    bar.style.width = '100%';
  });
  setTimeout(() => {
    modal.hidden = true;
    addBuff('ad', 'all', boost.mult, boost.seconds);
    app.adReadyAt = performance.now() + boost.cooldown * 1000;
    ui.toast(`×${boost.mult} к хайпу на ${boost.seconds} секунд`);
    refreshLog();
  }, 5000);
}

async function onSkin(id) {
  try {
    await api.skin(id);
    app.state.player.skin = id;
    drawCreature();
    renderShopPanel();
  } catch (e) {
    ui.toast(e.message);
  }
}

// -------------------------------------------------------------- синхронизация
async function sync() {
  if (!app.state) return;
  app.dirty = false;
  try {
    await api.sync({
      hype: app.hype, total_hype: app.total, subs: app.subs,
      cringe: app.cringe, clicks: app.clicks,
    });
  } catch (e) { /* потеря одного автосейва не страшна */ }
}

async function refreshLog() {
  try {
    const st = await api.state();
    adopt(st, false);
  } catch (e) { /* не критично */ }
}

function adopt(st, takeCounters = true) {
  const prevSkin = app.state && app.state.player.skin;
  app.state = st;
  app.cfg = st.config;
  app.d = st.derived;
  app.hype = st.player.hype;
  if (takeCounters) {
    app.total = st.player.total_hype;
    app.subs = st.player.subs;
    app.cringe = st.player.cringe;
    app.clicks = st.player.clicks;
  } else {
    app.total = Math.max(app.total, st.player.total_hype);
  }
  if (prevSkin !== st.player.skin) drawCreature();
  document.getElementById('rhythm').hidden = !app.d.rhythm_mult;
  renderAll();
}

function drawCreature() {
  const skin = app.state.skins.find((s) => s.id === app.state.player.skin)
    || app.state.skins[0];
  document.getElementById('cheremshaArt').innerHTML = renderCheremsha(skin);
}

function renderShopPanel() {
  ui.renderShop(app.state, { onShop, onSkin });
}

function renderAll() {
  ui.renderUpgrades(app.state, app.hype, buy);
  renderShopPanel();
  ui.renderLog(app.state.events);
  drawHud();
}

// ------------------------------------------------------------------ старт
async function boot() {
  const st = await api.state();
  adopt(st, true);
  drawCreature();

  if (st.offline) ui.showOffline(st.offline);

  const btn = document.getElementById('cheremsha');
  btn.addEventListener('pointerdown', onClick);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());

  document.getElementById('btnReset').onclick = async () => {
    if (!confirm('Сбросить прогресс и начать заново?')) return;
    adopt(await api.reset(), true);
    drawCreature();
    endEvent();
    app.buffs = [];
    scheduleEvent();
  };

  document.querySelectorAll('[data-close-offline]').forEach((b) => {
    b.onclick = () => { document.getElementById('offlineModal').hidden = true; };
  });
  document.querySelectorAll('[data-close-mock]').forEach((b) => {
    b.onclick = () => { document.getElementById('mockModal').hidden = true; };
  });
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.onclick = () => {
      document.body.dataset.tab = b.dataset.tab;
      document.querySelectorAll('.tabbar button').forEach((x) => {
        x.classList.toggle('on', x === b);
      });
    };
  });
  document.querySelector('.tabbar button').classList.add('on');

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); onClick({}); }
  });
  // сохраняемся при уходе со страницы, чтобы оффлайн-доход считался честно
  window.addEventListener('pagehide', () => {
    navigator.sendBeacon?.('/api/sync', new Blob([JSON.stringify({
      hype: app.hype, total_hype: app.total, subs: app.subs,
      cringe: app.cringe, clicks: app.clicks,
    })], { type: 'application/json' }));
  });

  app.nextEventAt = performance.now() + app.cfg.event_first_delay * 1000;
  app.lastTick = performance.now();
  setInterval(sync, app.cfg.autosave_seconds * 1000);
  requestAnimationFrame(tick);
}

boot().catch((e) => {
  document.body.insertAdjacentHTML('afterbegin',
    `<div class="toast" style="top:20px;bottom:auto">Не удалось загрузить игру: ${e.message}</div>`);
});
