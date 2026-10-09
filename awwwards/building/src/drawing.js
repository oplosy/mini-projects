// Section drawing of Meridyen Kule (218 m, 52 floors + 6 basements).
// Every stroke has pathLength=1 so it can be drawn with a 0..1 dash offset.
// data-s groups strokes into drawing steps, in the order a site would build them.

const G = 740; // ground line
const TOP = 90; // roof
const L = 320;
const R = 480;
const FLOORS = 52;
const FH = (G - TOP) / FLOORS;

const p = (d, s, cls = '') => `<path class="d-line ${cls}" data-s="${s}" d="${d}" pathLength="1"/>`;
const ln = (x1, y1, x2, y2, s, cls) => p(`M${x1} ${y1}L${x2} ${y2}`, s, cls);
const t = (x, y, s, text, { anchor = 'start', cls = '', rotate } = {}) =>
  `<text class="d-label ${cls}" data-s="${s}" x="${x}" y="${y}" text-anchor="${anchor}"${
    rotate ? ` transform="rotate(${rotate} ${x} ${y})"` : ''
  }>${text}</text>`;

export function drawingSVG({ standalone = false } = {}) {
  const out = [];

  // 0 ground
  out.push(ln(-80, G, 920, G, 0, 'strong'));
  out.push(t(-74, G - 12, 0, 'Zemin kotu ±0,00', { cls: 'small' }));

  // 1 soil hatch
  for (let x = -66; x < 916; x += 18) {
    if (x > 284 && x < 520) continue;
    out.push(ln(x, G + 4, x - 9, G + 13, 1, 'thin'));
  }

  // 2 piles and raft
  for (let x = 310; x <= 490; x += 22.5) out.push(ln(x, 818, x, 865, 2));
  out.push(p('M290 806H510V818H290Z', 2, 'strong'));

  // 3 basements
  out.push(ln(300, G, 300, 806, 3, 'strong'));
  out.push(ln(500, G, 500, 806, 3, 'strong'));
  for (let i = 1; i < 6; i++) out.push(ln(300, G + i * 11, 500, G + i * 11, 3, 'thin'));

  // 4 tower outline
  out.push(ln(L, G, L, TOP, 4, 'strong'));
  out.push(ln(R, G, R, TOP, 4, 'strong'));

  // 5 floors, bottom to top
  for (let i = 1; i <= FLOORS; i++) {
    const y = +(G - i * FH).toFixed(2);
    out.push(ln(L, y, R, y, 5, i === FLOORS ? 'strong' : 'thin'));
  }

  // 6 core
  out.push(ln(380, 806, 380, TOP, 6));
  out.push(ln(420, 806, 420, TOP, 6));

  // 7 crown and mast
  out.push(p(`M336 ${TOP}V66H464V${TOP}`, 7, 'strong'));
  out.push(ln(400, 66, 400, 24, 7));

  // 8 dimensions
  out.push(ln(488, TOP, 572, TOP, 8, 'thin'));
  out.push(ln(504, G, 572, G, 8, 'thin'));
  out.push(ln(560, TOP, 560, G, 8));
  out.push(ln(553, TOP + 7, 567, TOP - 7, 8));
  out.push(ln(553, G + 7, 567, G - 7, 8));
  out.push(t(584, (TOP + G) / 2, 8, '218,4 m', { anchor: 'middle', rotate: -90, cls: 'dim' }));

  out.push(ln(242, 865, 304, 865, 8, 'thin'));
  out.push(ln(250, G, 250, 865, 8));
  out.push(ln(243, G + 7, 257, G - 7, 8));
  out.push(ln(243, 872, 257, 858, 8));
  out.push(t(236, (G + 865) / 2, 8, '−42,0 m', { anchor: 'middle', rotate: -90, cls: 'dim' }));

  // 9 callouts
  const fy = G - 30.5 * FH;
  out.push(p(`M${R + 14} ${fy}a14 14 0 1 1 -28 0a14 14 0 1 1 28 0`, 9));
  out.push(p(`M${R + 14} ${fy}L612 300H624`, 9, 'thin'));
  out.push(t(630, 290, 9, 'Tipik kat yüksekliği', { cls: 'small' }));
  out.push(t(630, 326, 9, '3,85 m', { cls: 'value' }));

  out.push(p(`M${R} 190L612 160H624`, 9, 'thin'));
  out.push(t(630, 150, 9, 'Cephe', { cls: 'small' }));
  out.push(t(630, 186, 9, '2.140 cam panel', { cls: 'value' }));

  out.push(p('M420 520L612 548H624', 9, 'thin'));
  out.push(t(630, 538, 9, 'Çekirdek perdeler', { cls: 'small' }));
  out.push(t(630, 574, 9, '38.400 m³ beton', { cls: 'value' }));

  out.push(p('M300 773L214 650H206', 9, 'thin'));
  out.push(t(200, 640, 9, '6 bodrum kat', { anchor: 'end', cls: 'small' }));
  out.push(t(200, 676, 9, '1.100 araç', { anchor: 'end', cls: 'value' }));

  out.push(p('M290 812L216 892H206', 9, 'thin'));
  out.push(t(200, 876, 9, 'Radye, 186 kazık', { anchor: 'end', cls: 'small' }));
  out.push(t(200, 912, 9, '11.400 t çelik', { anchor: 'end', cls: 'value' }));

  // standalone: finished drawing with inline styles, used as the texture on the studio sheet
  const style = standalone
    ? `<style>.d-line{fill:none;stroke:#2a2e32;stroke-width:1.6}.strong{stroke-width:2.8}.thin{stroke-width:0.9}.d-label{font-family:Arial,sans-serif;font-size:22px;fill:#2a2e32}.small{fill:#6b7378;font-size:21px}.value,.dim{font-size:30px;font-weight:700}</style>`
    : '';
  return `<svg ${standalone ? 'xmlns="http://www.w3.org/2000/svg" width="1040" height="930"' : 'class="drawing__svg"'} viewBox="-100 0 1040 930" role="img" aria-labelledby="kesit-title kesit-desc">${style}
  <title id="kesit-title">Meridyen Kule düşey kesiti</title>
  <desc id="kesit-desc">218,4 metre yüksekliğinde, 52 normal kat ve 6 bodrum kattan oluşan kule. Temel 42 metre derinliğe inen 186 fore kazık ve radye temel üzerinde. Tipik kat yüksekliği 3,85 metre, cephede 2.140 cam panel, çekirdek perdelerde 38.400 metreküp beton, toplam 11.400 ton çelik kullanıldı.</desc>
  ${out.join('\n  ')}
</svg>`;
}
