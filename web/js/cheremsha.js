// Рисуем саму Черемшу: гибрид льва и зайца из мема.
// Готовую картинку не берём — рисуем SVG-ом, поэтому скины меняются на лету
// и нет вопросов к правам на исходное изображение.

function star(cx, cy, rOut, rIn, spikes, rot = 0) {
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (Math.PI * i) / spikes - Math.PI / 2 + rot;
    const r = i % 2 ? rIn : rOut;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16 & 255)},${c(n >> 8 & 255)},${c(n & 255)})`;
}

function accessory(kind, fur, mane) {
  if (kind === 'ushanka') {
    return `
      <g>
        <path d="M56 66 q44 -42 88 0 q6 -30 -44 -32 q-50 2 -44 32Z" fill="#6b4a2c" stroke="#3d2917" stroke-width="3"/>
        <rect x="52" y="58" width="96" height="20" rx="10" fill="#8a6136" stroke="#3d2917" stroke-width="3"/>
        <ellipse cx="52" cy="86" rx="13" ry="20" fill="#8a6136" stroke="#3d2917" stroke-width="3"/>
        <ellipse cx="148" cy="86" rx="13" ry="20" fill="#8a6136" stroke="#3d2917" stroke-width="3"/>
        <path d="M92 50 l8 -14 l8 14Z" fill="#d9433f" stroke="#3d2917" stroke-width="2"/>
      </g>`;
  }
  if (kind === 'helmet') {
    return `
      <g>
        <circle cx="100" cy="100" r="66" fill="rgba(160,210,255,.16)" stroke="#dfe3ea" stroke-width="5"/>
        <path d="M52 72 q22 -22 52 -24" fill="none" stroke="#fff" stroke-width="6" opacity=".55" stroke-linecap="round"/>
        <rect x="70" y="160" width="60" height="16" rx="8" fill="#dfe3ea" stroke="#8d97a8" stroke-width="3"/>
      </g>`;
  }
  if (kind === 'vatnik') {
    return `
      <g>
        <path d="M46 168 q54 -26 108 0 l0 34 l-108 0Z" fill="#5d6647" stroke="#39402a" stroke-width="3"/>
        <path d="M64 170 l0 32 M82 166 l0 36 M100 164 l0 38 M118 166 l0 36 M136 170 l0 32"
              stroke="#39402a" stroke-width="2" opacity=".8"/>
      </g>`;
  }
  if (kind === 'glitch') {
    return `
      <g opacity=".55" style="mix-blend-mode:screen">
        <ellipse cx="94" cy="100" rx="44" ry="40" fill="#4fd9c7"/>
        <ellipse cx="106" cy="100" rx="44" ry="40" fill="#ff4fd0"/>
      </g>
      <g opacity=".35">
        <path d="M40 84 h120 M40 108 h120 M40 132 h120" stroke="#0b0b12" stroke-width="3"/>
      </g>`;
  }
  return '';
}

export function renderCheremsha(skin) {
  const fur = skin.fur || '#c9a227';
  const mane = skin.mane || '#8a5a1e';
  const dark = shade(mane, 0.62);
  const light = shade(fur, 1.22);
  const glitch = skin.acc === 'glitch';

  return `
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="fg" cx="38%" cy="30%">
      <stop offset="0%" stop-color="${light}"/>
      <stop offset="100%" stop-color="${fur}"/>
    </radialGradient>
    <style>
      .breathe { animation: br 3.4s ease-in-out infinite; transform-origin: 100px 110px; }
      .ear-l { animation: earL 5s ease-in-out infinite; transform-origin: 82px 76px; }
      .ear-r { animation: earR 6.2s ease-in-out infinite; transform-origin: 118px 76px; }
      .blink { animation: blink 5.6s infinite; transform-origin: center; }
      @keyframes br { 0%,100% { transform: scale(1) } 50% { transform: scale(1.028) } }
      @keyframes earL { 0%,86%,100% { transform: rotate(0deg) } 92% { transform: rotate(-11deg) } }
      @keyframes earR { 0%,80%,100% { transform: rotate(0deg) } 88% { transform: rotate(10deg) } }
      @keyframes blink { 0%,94%,100% { transform: scaleY(1) } 97% { transform: scaleY(.1) } }
      @media (prefers-reduced-motion: reduce) { .breathe,.ear-l,.ear-r,.blink { animation: none } }
    </style>
  </defs>

  <g class="breathe">
    <!-- грива льва -->
    <path d="${star(100, 104, 82, 56, 15, 0.21)}" fill="${dark}"/>
    <path d="${star(100, 104, 76, 54, 15, 0)}" fill="${mane}"/>

    <!-- заячьи уши -->
    <g class="ear-l">
      <ellipse cx="80" cy="42" rx="12" ry="34" fill="${fur}" stroke="${dark}" stroke-width="3" transform="rotate(-14 80 60)"/>
      <ellipse cx="80" cy="44" rx="5" ry="23" fill="#e8a0a8" opacity=".75" transform="rotate(-14 80 60)"/>
    </g>
    <g class="ear-r">
      <ellipse cx="120" cy="42" rx="12" ry="34" fill="${fur}" stroke="${dark}" stroke-width="3" transform="rotate(14 120 60)"/>
      <ellipse cx="120" cy="44" rx="5" ry="23" fill="#e8a0a8" opacity=".75" transform="rotate(14 120 60)"/>
    </g>

    <!-- морда -->
    <ellipse cx="100" cy="104" rx="46" ry="42" fill="url(#fg)" stroke="${dark}" stroke-width="3"/>

    <!-- брови хищника -->
    <path d="M70 84 l22 8" stroke="${dark}" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M130 84 l-22 8" stroke="${dark}" stroke-width="4.5" stroke-linecap="round"/>

    <!-- глаза -->
    <g class="blink">
      <ellipse cx="83" cy="99" rx="11" ry="9" fill="#fdf6e6"/>
      <ellipse cx="117" cy="99" rx="11" ry="9" fill="#fdf6e6"/>
      <ellipse cx="85" cy="100" rx="5.4" ry="6.4" fill="#181008"/>
      <ellipse cx="119" cy="100" rx="5.4" ry="6.4" fill="#181008"/>
      <circle cx="87" cy="97.5" r="1.9" fill="#fff"/>
      <circle cx="121" cy="97.5" r="1.9" fill="#fff"/>
    </g>

    <!-- нос и пасть -->
    <ellipse cx="100" cy="120" rx="25" ry="17" fill="${light}" opacity=".85"/>
    <path d="M92 114 h16 l-8 8Z" fill="#2a1a10"/>
    <path d="M100 122 v6 M100 128 q-9 7 -15 -1 M100 128 q9 7 15 -1"
          stroke="#2a1a10" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M92 131 l-3 5 M108 131 l3 5" stroke="#fdf6e6" stroke-width="3" stroke-linecap="round"/>

    <!-- усы -->
    <path d="M74 118 l-22 -5 M74 124 l-23 3 M126 118 l22 -5 M126 124 l23 3"
          stroke="${dark}" stroke-width="2" opacity=".7" stroke-linecap="round"/>

    ${accessory(skin.acc, fur, mane)}
  </g>
  ${glitch ? '' : ''}
</svg>`;
}
