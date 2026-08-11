// Рендер панелей, HUD, журнала и модалок.

const $ = (s) => document.querySelector(s);

// ------------------------------------------------------------- числа
const UNITS = [
  [1e15, 'квдрлн'], [1e12, 'трлн'], [1e9, 'млрд'], [1e6, 'млн'], [1e3, 'тыс'],
];

export const fmt = {
  n(v) {
    v = Number(v) || 0;
    const sign = v < 0 ? '−' : '';
    v = Math.abs(v);
    for (const [size, name] of UNITS) {
      if (v >= size) {
        const x = v / size;
        return `${sign}${x < 10 ? x.toFixed(2) : x < 100 ? x.toFixed(1) : Math.round(x)} ${name}`;
      }
    }
    return sign + Math.floor(v).toLocaleString('ru-RU');
  },
  rate(v) {
    return `${fmt.n(v)} / сек`;
  },
  time(ts) {
    const d = new Date(ts * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
  dur(sec) {
    sec = Math.round(sec);
    if (sec < 60) return `${sec} с`;
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m} мин`;
    return `${Math.floor(m / 60)} ч ${m % 60} мин`;
  },
};

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ------------------------------------------------------------- HUD
export function renderStats(g) {
  $('#statHype').textContent = fmt.n(g.hype);
  $('#statRate').textContent = fmt.rate(g.rate);
  $('#statSubs').textContent = fmt.n(g.subs);
  $('#statCringe').textContent = `${Math.round(g.cringe)}%`;

  const bar = $('#barCringe');
  bar.style.width = `${g.cringe}%`;
  bar.style.background = g.cringe > 75 ? '#d9433f' : g.cringe > 45 ? '#d8a13a' : '#7fc76a';

  $('#clickPower').textContent = `+${fmt.n(g.clickPower)}`;
  $('#clickExtras').textContent = g.extras.join(' · ');
}

export function renderStage(state, subs) {
  const stages = state.stages;
  const i = state.player.stage;
  const cur = stages[i];
  const next = stages[i + 1];
  document.documentElement.style.setProperty('--accent', cur.accent);

  $('#stageName').textContent = `${i + 1}. ${cur.name}`;
  $('#stageTag').textContent = cur.tagline;
  $('#statStage').textContent = cur.name;

  if (next) {
    const from = cur.subs;
    const p = Math.max(0, Math.min(1, (subs - from) / (next.subs - from)));
    $('#stageFill').style.width = `${p * 100}%`;
    $('#stageNext').textContent =
      `до «${next.name}» — ${fmt.n(Math.max(0, next.subs - subs))} подписчиков`;
  } else {
    $('#stageFill').style.width = '100%';
    $('#stageNext').textContent = 'финальный этап открыт';
  }
}

// ------------------------------------------------------- улучшения
export function renderUpgrades(state, hype, onBuy) {
  const box = $('#upgrades');
  box.innerHTML = '';
  const open = state.upgrades.filter((u) => u.unlocked);
  $('#upgHint').textContent = `${open.filter((u) => u.level > 0).length} из ${state.upgrades.length} в работе`;

  for (const u of state.upgrades) {
    const affordable = u.unlocked && !u.maxed && hype >= u.cost;
    const card = el(`
      <div class="card ${u.unlocked ? '' : 'locked'} ${affordable ? 'buyable' : ''}">
        <div class="card-top">
          <div class="card-name">${u.icon} ${u.name}
            ${u.kind === 'mechanic' ? '<span class="tagm">механика</span>' : ''}</div>
          <span class="card-lvl">${u.level > 0 ? `ур. ${u.level}` : ''}${u.maxed ? ' · max' : ''}</span>
        </div>
        <div class="card-desc">${u.desc}</div>
        <div class="card-foot">
          <span class="card-hint">${u.hint}</span>
          <span class="card-cost ${affordable ? '' : 'poor'}">${
            u.maxed ? '—'
              : u.unlocked ? fmt.n(u.cost)
                : `этап «${state.stages[u.stage].name}»`}</span>
        </div>
      </div>`);
    if (u.unlocked && !u.maxed) card.onclick = () => onBuy(u.id);
    box.append(card);
  }
}

// ---------------------------------------------------------- витрина
export function renderShop(state, handlers) {
  const box = $('#shop');
  box.innerHTML = '';
  for (const item of state.shop) {
    const card = el(`
      <div class="card buyable">
        <div class="card-top">
          <div class="card-name">${item.icon} ${item.name}</div>
          <span class="card-cost">${item.price}</span>
        </div>
        <div class="card-desc">${item.desc}</div>
        <div class="card-foot"><span class="card-hint">${item.model}</span></div>
      </div>`);
    card.onclick = () => handlers.onShop(item);
    box.append(card);
  }

  const sk = $('#skins');
  sk.innerHTML = '';
  for (const s of state.skins) {
    const on = state.player.skin === s.id;
    const chip = el(`<button class="skin ${on ? 'on' : ''}">
      <i style="background:${s.fur}"></i>${s.name}
      <em>${s.price ? `${s.price} ₽` : 'входит'}</em></button>`);
    chip.onclick = () => handlers.onSkin(s.id);
    sk.append(chip);
  }

  const bp = $('#battlepass');
  bp.innerHTML = '';
  for (const t of state.battlepass) {
    const p = Math.max(0, Math.min(1, t.value / t.goal));
    bp.append(el(`<div class="bp-row ${t.done ? 'done' : ''}">
      <div class="bp-top"><b>${t.done ? '✓ ' : ''}${t.text}</b>
        <span>${fmt.n(Math.min(t.value, t.goal))} / ${fmt.n(t.goal)}</span></div>
      <div class="bp-bar"><i style="width:${p * 100}%"></i></div>
    </div>`));
  }
}

// ----------------------------------------------------------- журнал
export function renderLog(events) {
  const box = $('#log');
  box.innerHTML = '';
  for (const e of events) {
    const d = e.hype_delta;
    box.append(el(`<div class="log-line ${e.kind}">
      <span class="li">${e.icon || '•'}</span>
      <span class="lt"><b>${e.title}</b><small>${e.text || ''}</small></span>
      <span class="ld" style="color:${d > 0 ? '#7fc76a' : d < 0 ? '#d9433f' : 'transparent'}">
        ${d ? (d > 0 ? '+' : '−') + fmt.n(Math.abs(d)) : '·'}</span>
    </div>`));
  }
  const mini = $('#minilog');
  const last = events[0];
  mini.innerHTML = last
    ? `<b style="color:#fff">${last.icon} ${last.title}</b> — ${last.text || ''}`
    : '';
}

// ---------------------------------------------------- баннер события
export function showEvent(ev, onFix) {
  const b = $('#eventBanner');
  b.className = `event-banner ${ev.kind}`;
  b.hidden = false;
  b.innerHTML = `
    <span class="ev-icon">${ev.icon}</span>
    <span class="ev-body">
      <b>${ev.title}</b>
      <p>${ev.text}</p>
      <span class="ev-time" id="evTime"></span>
    </span>`;
  if (ev.fix) {
    const btn = el(`<button class="btn btn-sm">${ev.fix.label} · ${fmt.n(ev.fix.cost)}</button>`);
    btn.onclick = () => onFix(ev);
    b.querySelector('.ev-body').append(btn);
  }
}

export function updateEventTimer(left) {
  const t = $('#evTime');
  if (t) t.textContent = left > 0 ? `осталось ${Math.ceil(left)} с` : '';
}

export function hideEvent() { $('#eventBanner').hidden = true; }

// --------------------------------------------------------- флоатеры
const floaters = () => $('#floaters');

export function floater(x, y, text, cls = '') {
  const f = el(`<span class="floater ${cls}">${text}</span>`);
  f.style.left = `${x}px`;
  f.style.top = `${y}px`;
  floaters().append(f);
  setTimeout(() => f.remove(), 900);
}

// ----------------------------------------------------------- модалки
export function showOffline(info) {
  $('#offlineBody').innerHTML = `
    <p class="note" style="margin-top:6px">Вас не было ${fmt.dur(info.seconds)}.
      Цех работал по «Госплану» на ${Math.round(info.rate * 100)}% мощности${
        info.capped ? ', но накопление упирается в лимит 8 часов' : ''}.</p>
    <div class="big-number">+${fmt.n(info.gain)} хайпа</div>`;
  $('#offlineModal').hidden = false;
}

export function showMock(title, text) {
  $('#mockTitle').textContent = title;
  $('#mockBody').innerHTML = `<p class="note" style="margin-top:6px">${text}</p>`;
  $('#mockModal').hidden = false;
}

let toastTimer = null;
export function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}
