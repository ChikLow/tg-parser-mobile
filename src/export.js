// Експорт результатів: JSON / CSV / TXT / HTML + збереження чи «Поділитися» на телефоні.

import { fmtBytes, fmtDate, escapeHtml } from './ui.js'

const CSV_DELIM = ';' // Excel в українській локалі очікує саме крапку з комою

function csvCell(value) {
  if (value === null || value === undefined) return ''
  let s = Array.isArray(value) ? value.join(' | ') : String(value)
  s = s.replace(/\r?\n/g, ' ⏎ ')
  if (s.includes(CSV_DELIM) || s.includes('"') || s.includes('\n')) {
    s = `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function toCSV(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(CSV_DELIM)
  const body = rows.map((r) => columns.map((c) => csvCell(c.get(r))).join(CSV_DELIM))
  return `﻿${[head, ...body].join('\r\n')}\r\n`
}

export const MESSAGE_COLUMNS = [
  { label: 'ID', get: (m) => m.id },
  { label: 'Дата', get: (m) => fmtDate(m.date) },
  { label: 'ISO дата', get: (m) => m.date },
  { label: 'Автор', get: (m) => m.senderName },
  { label: 'Username автора', get: (m) => (m.senderUsername ? `@${m.senderUsername}` : '') },
  { label: 'ID автора', get: (m) => m.senderId },
  { label: 'Текст', get: (m) => m.text },
  { label: 'Перегляди', get: (m) => m.views ?? '' },
  { label: 'Пересилань', get: (m) => m.forwards ?? '' },
  { label: 'Реакцій', get: (m) => m.reactions ?? '' },
  { label: 'Коментарів', get: (m) => m.replies ?? '' },
  { label: 'Медіа', get: (m) => m.media },
  { label: 'Файл', get: (m) => m.fileName },
  { label: 'Розмір', get: (m) => (m.fileSize ? fmtBytes(m.fileSize) : '') },
  { label: 'Посилання в тексті', get: (m) => m.urls },
  { label: 'Хештеги', get: (m) => m.hashtags },
  { label: 'Згадки', get: (m) => m.mentions },
  { label: 'Переслано від', get: (m) => m.fwdFrom },
  { label: 'Відповідь на', get: (m) => m.replyToId ?? '' },
  { label: 'Посилання', get: (m) => m.link },
]

export const MEMBER_COLUMNS = [
  { label: 'ID', get: (u) => u.id },
  { label: 'Username', get: (u) => (u.username ? `@${u.username}` : '') },
  { label: "Ім'я", get: (u) => u.firstName },
  { label: 'Прізвище', get: (u) => u.lastName },
  { label: 'Повне ім\'я', get: (u) => u.name },
  { label: 'Телефон', get: (u) => u.phone },
  { label: 'Бот', get: (u) => (u.isBot ? 'так' : '') },
  { label: 'Premium', get: (u) => (u.isPremium ? 'так' : '') },
  { label: 'Був онлайн', get: (u) => u.status },
  { label: 'Посилання', get: (u) => u.link },
]

export function toTXT(rows, meta) {
  const head = [
    `Telegram парсинг — ${meta?.peer?.title ?? ''}`,
    meta?.peer?.username ? `@${meta.peer.username}` : '',
    `Повідомлень: ${rows.length}`,
    `Створено: ${fmtDate(new Date().toISOString())}`,
    '='.repeat(40),
    '',
  ].filter(Boolean)

  const body = rows.map((m) => {
    const who = m.senderName || m.senderUsername || m.senderId || 'Невідомо'
    const stats = [
      m.views != null ? `👁 ${m.views}` : '',
      m.forwards ? `↗ ${m.forwards}` : '',
      m.reactions ? `❤ ${m.reactions}` : '',
      m.media ? `[${m.media}${m.fileName ? `: ${m.fileName}` : ''}]` : '',
    ].filter(Boolean).join('  ')
    return [
      `[${fmtDate(m.date)}] ${who} (#${m.id})`,
      m.text || '(без тексту)',
      stats,
      m.link,
      '-'.repeat(40),
    ].filter(Boolean).join('\n')
  })

  return [...head, ...body].join('\n')
}

export function toHTML(rows, meta) {
  const title = `Telegram — ${meta?.peer?.title ?? 'парсинг'}`
  const cards = rows.map((m) => `
    <article>
      <header>
        <strong>${escapeHtml(m.senderName || m.senderUsername || m.senderId || '—')}</strong>
        <time>${escapeHtml(fmtDate(m.date))}</time>
      </header>
      ${m.text ? `<p>${escapeHtml(m.text).replace(/\n/g, '<br>')}</p>` : ''}
      ${m.media ? `<div class="media">📎 ${escapeHtml(m.media)}${m.fileName ? ` — ${escapeHtml(m.fileName)}` : ''}</div>` : ''}
      <footer>
        ${m.views != null ? `👁 ${m.views}` : ''}
        ${m.forwards ? `↗ ${m.forwards}` : ''}
        ${m.reactions ? `❤ ${m.reactions}` : ''}
        ${m.link ? `<a href="${escapeHtml(m.link)}">відкрити</a>` : ''}
      </footer>
    </article>`).join('\n')

  return `<!doctype html>
<html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 -apple-system, system-ui, sans-serif; margin: 0; padding: 16px; background: #f5f6f8; color: #16191d; }
  @media (prefers-color-scheme: dark) { body { background: #12161c; color: #e7ecf3; } article { background: #1b2029 !important; } }
  h1 { font-size: 20px; }
  .meta { opacity: .7; font-size: 13px; margin-bottom: 16px; }
  article { background: #fff; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  header { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; opacity: .8; margin-bottom: 6px; }
  p { margin: 6px 0; white-space: pre-wrap; word-break: break-word; }
  footer { display: flex; gap: 10px; font-size: 12px; opacity: .65; margin-top: 6px; }
  .media { font-size: 13px; opacity: .8; }
  a { color: #3390ec; }
</style></head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">
  ${meta?.peer?.username ? `@${escapeHtml(meta.peer.username)} · ` : ''}
  Повідомлень: ${rows.length} · Створено: ${escapeHtml(fmtDate(new Date().toISOString()))}
</div>
${cards}
</body></html>`
}

export function toJSON(rows, meta) {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    source: meta?.peer ?? null,
    params: meta?.params ?? null,
    stats: { count: rows.length, scanned: meta?.scanned ?? null },
    items: rows,
  }, null, 2)
}

/* --------------------------------------------------------- збереження --- */

export function buildFile(kind, format, rows, meta) {
  const slug = (meta?.peer?.username || meta?.peer?.title || 'telegram')
    .toString().toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40)
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const base = `${slug || 'telegram'}-${kind}-${stamp}`
  const columns = kind === 'members' ? MEMBER_COLUMNS : MESSAGE_COLUMNS

  switch (format) {
    case 'csv':
      return { blob: new Blob([toCSV(rows, columns)], { type: 'text/csv;charset=utf-8' }), name: `${base}.csv` }
    case 'txt':
      return { blob: new Blob([toTXT(rows, meta)], { type: 'text/plain;charset=utf-8' }), name: `${base}.txt` }
    case 'html':
      return { blob: new Blob([toHTML(rows, meta)], { type: 'text/html;charset=utf-8' }), name: `${base}.html` }
    case 'json':
    default:
      return { blob: new Blob([toJSON(rows, meta)], { type: 'application/json;charset=utf-8' }), name: `${base}.json` }
  }
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 4000)
}

export function canShareFiles(blob, name) {
  try {
    const file = new File([blob], name, { type: blob.type })
    return Boolean(navigator.canShare?.({ files: [file] }))
  } catch {
    return false
  }
}

export async function shareBlob(blob, name, title) {
  const file = new File([blob], name, { type: blob.type })
  await navigator.share({ files: [file], title: title || name })
}
