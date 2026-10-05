import { Resvg } from '@resvg/resvg-js';
import { fileURLToPath } from 'node:url';

const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
const FONTS = ['Inter-400', 'Inter-600', 'Inter-700', 'Inter-ext-400', 'Inter-ext-600', 'Inter-ext-700'].map((name) => `${FONT_DIR}${name}.ttf`);
const W = 1000;
const PAD = 36;
const INNER = W - PAD * 2;
const INK = '#0F172A';
const MUTED = '#64748B';
const LINE = '#E2E8F0';
const GOOD = '#16A34A';
const BAD = '#DC2626';
export const PALETTE = ['#2563EB', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899', '#84CC16'];
const THEMES = {
  ads: ['#4F46E5', '#7C3AED'],
  calls: ['#0EA5E9', '#2563EB'],
  hours: ['#0D9488', '#0EA5E9']
};

const ICONS = {
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  pointer: '<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  percent: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2z"/>'
};

export function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function textWidth(value, size, weight = 400) {
  return String(value).length * size * (weight >= 600 ? 0.6 : 0.56);
}

export function clip(value, maxWidth, size, weight = 400) {
  const textValue = String(value ?? '');
  if (textWidth(textValue, size, weight) <= maxWidth) return textValue;
  const chars = Math.max(1, Math.floor(maxWidth / (size * (weight >= 600 ? 0.6 : 0.56))) - 1);
  return `${textValue.slice(0, chars).trimEnd()}…`;
}

function wrap(value, maxWidth, size, maxLines = 3) {
  const words = String(value || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (textWidth(next, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = clip(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, maxWidth, size);
    return kept;
  }
  return lines;
}

function text(x, y, value, { size = 22, weight = 400, fill = INK, anchor = 'start', opacity = 1 } = {}) {
  return `<text x="${x}" y="${y}" font-family="Inter" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}>${esc(value)}</text>`;
}

function icon(name, x, y, size, color) {
  if (name === 'rupee') return text(x + size / 2, y + size * 0.82, '₹', { size: size * 0.95, weight: 700, fill: color, anchor: 'middle' });
  return `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.chart}</g>`;
}

function card(y, h, inner = '') {
  return `<rect x="${PAD}" y="${y}" width="${INNER}" height="${h}" rx="24" fill="#FFFFFF" stroke="${LINE}"/>${inner}`;
}

function niceMax(value, whole = false) {
  if (value <= 0) return 4;
  const raw = value / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((item) => item * power >= raw) * power;
  return (whole ? Math.max(1, Math.ceil(step)) : step) * 4;
}

export function header({ theme, title, subtitle, business }) {
  const [from, to] = THEMES[theme] || THEMES.ads;
  const h = 168;
  return {
    h: h + 22,
    draw: (y) => [
      `<defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`,
      `<rect x="${PAD}" y="${y}" width="${INNER}" height="${h}" rx="28" fill="url(#hg)"/>`,
      `<circle cx="${W - PAD - 70}" cy="${y + 20}" r="110" fill="#FFFFFF" fill-opacity="0.08"/>`,
      `<circle cx="${W - PAD - 10}" cy="${y + h - 10}" r="70" fill="#FFFFFF" fill-opacity="0.07"/>`,
      `<rect x="${PAD + 30}" y="${y + 34}" width="76" height="76" rx="20" fill="#FFFFFF" fill-opacity="0.18"/>`,
      icon(theme === 'calls' ? 'phone' : theme === 'hours' ? 'clock' : 'chart', PAD + 48, y + 52, 40, '#FFFFFF'),
      text(PAD + 128, y + 70, clip(title, INNER - 300, 38, 700), { size: 38, weight: 700, fill: '#FFFFFF' }),
      icon('calendar', PAD + 128, y + 92, 22, '#FFFFFF'),
      text(PAD + 160, y + 111, clip(subtitle, INNER - 340, 23), { size: 23, fill: '#FFFFFF', opacity: 0.92 }),
      business ? text(PAD + 128, y + 146, clip(business, INNER - 300, 20), { size: 20, fill: '#FFFFFF', opacity: 0.78 }) : '',
      `<rect x="${W - PAD - 132}" y="${y + 30}" width="102" height="40" rx="20" fill="#FFFFFF" fill-opacity="0.2"/>`,
      text(W - PAD - 81, y + 57, 'AIRO', { size: 20, weight: 700, fill: '#FFFFFF', anchor: 'middle' })
    ].join('')
  };
}

export function tiles(items, cols = items.length >= 6 || items.length === 3 ? 3 : 2) {
  const gap = 18;
  const tileW = (INNER - gap * (cols - 1)) / cols;
  const tileH = 168;
  const rows = Math.ceil(items.length / cols);
  return {
    h: rows * tileH + (rows - 1) * gap + 22,
    draw: (y) => items.map((item, index) => {
      const x = PAD + (index % cols) * (tileW + gap);
      const top = y + Math.floor(index / cols) * (tileH + gap);
      const color = item.color || PALETTE[index % PALETTE.length];
      const delta = item.delta;
      const deltaColor = delta == null ? MUTED : (delta >= 0) === (item.goodWhenUp !== false) ? GOOD : BAD;
      return [
        `<rect x="${x}" y="${top}" width="${tileW}" height="${tileH}" rx="22" fill="#FFFFFF" stroke="${LINE}"/>`,
        `<rect x="${x + 22}" y="${top + 22}" width="52" height="52" rx="16" fill="${color}" fill-opacity="0.13"/>`,
        icon(item.icon, x + 34, top + 34, 28, color),
        text(x + 88, top + 56, clip(item.label, tileW - 104, 21), { size: 21, fill: MUTED, weight: 600 }),
        text(x + 24, top + 122, clip(item.value, tileW - 40, cols === 3 ? 36 : 40, 700), { size: cols === 3 ? 36 : 40, weight: 700 }),
        delta != null
          ? text(x + 24, top + 152, `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% ${item.deltaNote || ''}`.trim(), { size: 19, weight: 600, fill: deltaColor })
          : item.note ? text(x + 24, top + 152, clip(item.note, tileW - 40, 19), { size: 19, fill: MUTED }) : ''
      ].join('');
    }).join('')
  };
}

function sectionTitle(y, title, iconName, color = '#4F46E5') {
  return [
    iconName ? icon(iconName, PAD + 30, y + 30, 26, color) : '',
    text(PAD + (iconName ? 68 : 30), y + 52, title, { size: 27, weight: 700 })
  ].join('');
}

function legend(items, rightX, y) {
  let x = rightX;
  const parts = [];
  for (const item of [...items].reverse()) {
    const width = textWidth(item.label, 19) + 34;
    x -= width;
    parts.push(item.line
      ? `<line x1="${x}" y1="${y - 6}" x2="${x + 20}" y2="${y - 6}" stroke="${item.color}" stroke-width="4" stroke-linecap="round"/><circle cx="${x + 10}" cy="${y - 6}" r="5" fill="${item.color}"/>`
      : `<rect x="${x}" y="${y - 16}" width="18" height="18" rx="5" fill="${item.color}"/>`);
    parts.push(text(x + 26, y, item.label, { size: 19, fill: MUTED }));
    x -= 14;
  }
  return parts.join('');
}

export function barLineChart({ title, iconName = 'trend', labels, bars, line, barLabel, lineLabel, barFormat, lineFormat, barColor = '#2563EB', lineColor = '#22C55E', note }) {
  const chartH = 300;
  const h = 120 + chartH + 70 + (note ? 40 : 0);
  return {
    h: h + 22,
    draw: (y) => {
      const left = PAD + 96;
      const right = W - PAD - (line ? 96 : 36);
      const top = y + 100;
      const bottom = top + chartH;
      const barMax = niceMax(Math.max(...bars, 0), true);
      const lineMax = line ? niceMax(Math.max(...line, 0)) : 1;
      const slot = (right - left) / Math.max(labels.length, 1);
      const barW = Math.min(56, slot * 0.58);
      const parts = [card(y, h), sectionTitle(y, title, iconName, barColor)];
      parts.push(legend([{ label: barLabel, color: barColor }, ...(line ? [{ label: lineLabel, color: lineColor, line: true }] : [])], W - PAD - 30, y + 52));
      for (let step = 0; step <= 4; step += 1) {
        const gy = bottom - (chartH * step) / 4;
        parts.push(`<line x1="${left}" y1="${gy}" x2="${right}" y2="${gy}" stroke="${LINE}" stroke-width="1.5"${step ? ' stroke-dasharray="6 6"' : ''}/>`);
        parts.push(text(left - 14, gy + 7, barFormat((barMax * step) / 4, true), { size: 18, fill: MUTED, anchor: 'end' }));
        if (line) parts.push(text(right + 14, gy + 7, lineFormat((lineMax * step) / 4, true), { size: 18, fill: MUTED }));
      }
      const every = Math.ceil(labels.length / 10);
      labels.forEach((labelText, index) => {
        const cx = left + slot * index + slot / 2;
        const barH = (bars[index] / barMax) * chartH;
        if (barH > 0) parts.push(`<rect x="${cx - barW / 2}" y="${bottom - barH}" width="${barW}" height="${barH}" rx="${Math.min(8, barW / 3)}" fill="${barColor}"/>`);
        if (labels.length <= 14 && bars[index] > 0 && barW >= 30) {
          const inside = barH >= 40;
          parts.push(text(cx, inside ? bottom - 14 : bottom - barH - 10, barFormat(bars[index], true), { size: 17, weight: 700, fill: inside ? '#FFFFFF' : INK, anchor: 'middle' }));
        }
        if (index % every === 0) parts.push(text(cx, bottom + 32, labelText, { size: 18, fill: MUTED, anchor: 'middle' }));
      });
      if (line) {
        const points = line.map((value, index) => [left + slot * index + slot / 2, bottom - (value / lineMax) * chartH]);
        parts.push(`<polyline points="${points.map(([px, py]) => `${px},${py}`).join(' ')}" fill="none" stroke="${lineColor}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`);
        for (const [px, py] of points) parts.push(`<circle cx="${px}" cy="${py}" r="7" fill="#FFFFFF" stroke="${lineColor}" stroke-width="4"/>`);
      }
      if (note) parts.push(text(PAD + 30, bottom + 78, clip(note, INNER - 60, 20), { size: 20, fill: MUTED }));
      return parts.join('');
    }
  };
}

export function donut({ title, iconName = 'target', items, centerValue, centerLabel, format }) {
  const shown = items.filter((item) => item.value > 0);
  const total = shown.reduce((sum, item) => sum + item.value, 0) || 1;
  const rows = Math.max(shown.length, 3);
  const h = Math.max(400, 120 + rows * 54 + 30);
  return {
    h: h + 22,
    draw: (y) => {
      const cx = PAD + 190;
      const cy = y + 100 + (h - 100) / 2 - 10;
      const r = 118;
      const circ = 2 * Math.PI * r;
      const parts = [card(y, h), sectionTitle(y, title, iconName)];
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#F1F5F9" stroke-width="48"/>`);
      let offset = 0;
      shown.forEach((item, index) => {
        const length = (item.value / total) * circ;
        const color = item.color || PALETTE[index % PALETTE.length];
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="48" stroke-dasharray="${Math.max(length - 3, 0.1)} ${circ}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`);
        offset += length;
      });
      parts.push(text(cx, cy + 6, centerValue, { size: 44, weight: 700, anchor: 'middle' }));
      parts.push(text(cx, cy + 40, centerLabel, { size: 19, fill: MUTED, anchor: 'middle' }));
      const lx = PAD + 400;
      const startY = cy - (shown.length * 54) / 2 + 30;
      shown.forEach((item, index) => {
        const ly = startY + index * 54;
        const color = item.color || PALETTE[index % PALETTE.length];
        const share = Math.round((item.value / total) * 100);
        parts.push(`<circle cx="${lx + 10}" cy="${ly - 8}" r="10" fill="${color}"/>`);
        parts.push(text(lx + 32, ly, clip(item.label, 300, 22, 600), { size: 22, weight: 600 }));
        parts.push(text(W - PAD - 30, ly, `${share}% · ${format ? format(item.value) : item.value}`, { size: 21, fill: MUTED, anchor: 'end' }));
      });
      return parts.join('');
    }
  };
}

export function table({ title, iconName = 'chart', columns, rows }) {
  const rowH = 58;
  const h = 100 + 50 + rows.length * rowH + 24;
  return {
    h: h + 22,
    draw: (y) => {
      const parts = [card(y, h), sectionTitle(y, title, iconName)];
      const left = PAD + 24;
      const width = INNER - 48;
      const totalWeight = columns.reduce((sum, column) => sum + column.weight, 0);
      let x = left;
      const xs = columns.map((column) => {
        const start = x;
        x += (column.weight / totalWeight) * width;
        return { start, end: x };
      });
      const headY = y + 92;
      parts.push(`<rect x="${left}" y="${headY}" width="${width}" height="50" rx="12" fill="#F1F5F9"/>`);
      columns.forEach((column, index) => {
        const { start, end } = xs[index];
        const anchor = column.align === 'right' ? 'end' : 'start';
        parts.push(text(anchor === 'end' ? end - 14 : start + 14, headY + 33, column.label, { size: 19, weight: 700, fill: MUTED, anchor }));
      });
      rows.forEach((row, rowIndex) => {
        const ry = headY + 50 + rowIndex * rowH;
        if (rowIndex) parts.push(`<line x1="${left}" y1="${ry}" x2="${left + width}" y2="${ry}" stroke="${LINE}"/>`);
        columns.forEach((column, index) => {
          const { start, end } = xs[index];
          const anchor = column.align === 'right' ? 'end' : 'start';
          const value = clip(row[column.key], end - start - 24, 21, index === 0 ? 600 : 400);
          parts.push(text(anchor === 'end' ? end - 14 : start + 14, ry + 37, value, { size: 21, weight: index === 0 ? 600 : 400, anchor }));
        });
      });
      return parts.join('');
    }
  };
}

export function hbars({ title, iconName = 'award', rows, format, maxValue }) {
  const rowH = 60;
  const h = 100 + rows.length * rowH + 20;
  const medals = ['#F59E0B', '#94A3B8', '#B45309'];
  return {
    h: h + 22,
    draw: (y) => {
      const parts = [card(y, h), sectionTitle(y, title, iconName)];
      const max = maxValue || Math.max(...rows.map((row) => row.value), 1);
      const nameX = PAD + 84;
      const barX = PAD + 330;
      const barEnd = W - PAD - (rows.some((row) => row.sub) ? 250 : 150);
      rows.forEach((row, index) => {
        const ry = y + 96 + index * rowH;
        const color = row.color || '#2563EB';
        if (row.rank) {
          parts.push(`<circle cx="${PAD + 48}" cy="${ry + 22}" r="18" fill="${row.rank <= 3 ? medals[row.rank - 1] : '#E2E8F0'}"/>`);
          parts.push(text(PAD + 48, ry + 29, String(row.rank), { size: 18, weight: 700, fill: row.rank <= 3 ? '#FFFFFF' : MUTED, anchor: 'middle' }));
        }
        parts.push(text(row.rank ? nameX : PAD + 30, ry + 30, clip(row.label, barX - nameX - 16, 22, 600), { size: 22, weight: 600 }));
        parts.push(`<rect x="${barX}" y="${ry + 8}" width="${barEnd - barX}" height="28" rx="14" fill="#F1F5F9"/>`);
        const filled = Math.max(row.value > 0 ? 14 : 0, ((barEnd - barX) * row.value) / max);
        if (filled) parts.push(`<rect x="${barX}" y="${ry + 8}" width="${Math.min(filled, barEnd - barX)}" height="28" rx="14" fill="${color}"/>`);
        parts.push(text(barEnd + 18, ry + 31, format(row.value), { size: 22, weight: 700 }));
        if (row.sub) parts.push(text(W - PAD - 26, ry + 31, row.sub, { size: 19, fill: row.subColor || MUTED, anchor: 'end', weight: 600 }));
      });
      return parts.join('');
    }
  };
}

export function statRows(items) {
  const rowH = 118;
  const h = items.length * rowH + 16;
  return {
    h: h + 22,
    draw: (y) => {
      const parts = [card(y, h)];
      items.forEach((item, index) => {
        const top = y + 8 + index * rowH;
        const color = item.color || PALETTE[index % PALETTE.length];
        if (index) parts.push(`<line x1="${PAD + 28}" y1="${top}" x2="${W - PAD - 28}" y2="${top}" stroke="${LINE}"/>`);
        parts.push(`<rect x="${PAD + 28}" y="${top + 24}" width="70" height="70" rx="20" fill="${color}" fill-opacity="0.14"/>`);
        parts.push(icon(item.icon, PAD + 45, top + 41, 36, color));
        parts.push(text(PAD + 124, top + 69, clip(item.label, 300, 28, 600), { size: 28, weight: 600 }));
        parts.push(text(W - PAD - 250, top + 72, clip(item.value, 230, 40, 700), { size: 40, weight: 700, anchor: 'end' }));
        const delta = item.delta;
        if (delta != null) {
          const good = (delta >= 0) === (item.goodWhenUp !== false);
          parts.push(text(W - PAD - 220, top + 58, `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}${item.deltaUnit || '%'}`, { size: 26, weight: 700, fill: delta === 0 ? MUTED : good ? GOOD : BAD }));
        }
        if (item.note) parts.push(text(W - PAD - 220, top + (delta != null ? 92 : 72), clip(item.note, 200, 19), { size: 19, fill: MUTED }));
      });
      return parts.join('');
    }
  };
}

export function callout({ title, lines, iconName = 'bulb', color = '#F59E0B', tint = '' }) {
  const wrapped = lines.flatMap((line) => wrap(line, INNER - 140, 22, 3));
  const h = 86 + wrapped.length * 34 + 18;
  return {
    h: h + 22,
    draw: (y) => [
      `<rect x="${PAD}" y="${y}" width="${INNER}" height="${h}" rx="24" fill="${tint || '#FFFFFF'}" stroke="${tint ? color : LINE}" stroke-opacity="${tint ? 0.35 : 1}"/>`,
      `<rect x="${PAD}" y="${y}" width="10" height="${h}" rx="5" fill="${color}"/>`,
      `<rect x="${PAD + 30}" y="${y + 26}" width="52" height="52" rx="16" fill="${color}" fill-opacity="0.14"/>`,
      icon(iconName, PAD + 42, y + 38, 28, color),
      text(PAD + 100, y + 61, clip(title, INNER - 140, 25, 700), { size: 25, weight: 700 }),
      ...wrapped.map((line, index) => text(PAD + 100, y + 104 + index * 34, line, { size: 22, fill: '#334155' }))
    ].join('')
  };
}

export function footer(value) {
  return {
    h: 50,
    draw: (y) => text(W / 2, y + 26, value, { size: 19, fill: MUTED, anchor: 'middle' })
  };
}

export function renderReport(blocks) {
  let y = PAD;
  const parts = [];
  for (const block of blocks.filter(Boolean)) {
    parts.push(block.draw(y));
    y += block.h;
  }
  const height = Math.ceil(y + PAD - 22);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}"><rect width="${W}" height="${height}" fill="#EEF2F8"/>${parts.join('')}</svg>`;
  return new Resvg(svg, {
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Inter' },
    fitTo: { mode: 'width', value: W }
  }).render().asPng();
}
