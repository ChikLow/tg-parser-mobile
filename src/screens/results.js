// Результати: перегляд, пошук усередині, статистика, експорт.

import {
  el, textInput, toast, empty, initials, avatarColor, fmtNumber, fmtBytes,
  fmtDate, debounce, modal, escapeHtml,
} from '../ui.js'
import { runtime } from '../state.js'
import * as tg from '../tg.js'
import { buildFile, downloadBlob, canShareFiles, shareBlob } from '../export.js'

const PAGE = 40

const MEDIA_ICON = {
  photo: '🖼', video: '🎬', document: '📄', audio: '🎵', voice: '🎤',
  sticker: '🩷', gif: '🎞', round: '⭕', contact: '👤', poll: '📊', geo: '📍', link: '🔗',
}

export function resultsScreen(ctx) {
  const hasMessages = runtime.results?.length > 0
  const hasMembers = runtime.members?.length > 0
  const tab = ctx.params?.tab || (hasMessages ? 'messages' : hasMembers ? 'members' : 'messages')

  if (!hasMessages && !hasMembers) {
    return {
      title: 'Результати',
      body: el('div', {}, [
        empty('📭', 'Поки нічого немає', 'Запусти парсинг — і результати з\'являться тут'),
        el('button', {
          class: 'btn btn--primary btn--block', type: 'button', text: 'До парсера',
          onclick: () => ctx.go('parse'),
        }),
      ]),
    }
  }

  const body = el('div', { class: 'stack' })

  if (hasMessages && hasMembers) {
    body.append(el('div', { class: 'row' }, [
      el('button', {
        class: `chip ${tab === 'messages' ? 'is-active' : ''}`, type: 'button',
        text: `💬 Повідомлення (${fmtNumber(runtime.results.length)})`,
        onclick: () => ctx.go('results', { tab: 'messages' }),
      }),
      el('button', {
        class: `chip ${tab === 'members' ? 'is-active' : ''}`, type: 'button',
        text: `👥 Учасники (${fmtNumber(runtime.members.length)})`,
        onclick: () => ctx.go('results', { tab: 'members' }),
      }),
    ]))
  }

  body.append(tab === 'members' ? membersView(ctx) : messagesView(ctx))

  const meta = tab === 'members' ? runtime.membersMeta : runtime.resultsMeta
  return {
    title: 'Результати',
    subtitle: meta?.peer?.title || '',
    body,
  }
}

/* -------------------------------------------------------- повідомлення --- */

function messagesView(ctx) {
  const all = runtime.results
  const meta = runtime.resultsMeta
  let shown = PAGE
  let query = ''
  let sort = 'new'

  const host = el('div')
  const listHost = el('section', { class: 'section' }, [])

  const search = textInput({
    type: 'search', placeholder: 'Пошук серед знайденого…',
    oninput: debounce((e) => { query = e.target.value.trim().toLowerCase(); shown = PAGE; renderList() }, 180),
  })

  const sortSel = el('select', {
    class: 'input', style: 'max-width:190px',
    onchange: (e) => { sort = e.target.value; renderList() },
  }, [
    el('option', { value: 'new', text: 'Спочатку нові' }),
    el('option', { value: 'old', text: 'Спочатку старі' }),
    el('option', { value: 'views', text: 'За переглядами' }),
    el('option', { value: 'reactions', text: 'За реакціями' }),
    el('option', { value: 'long', text: 'Найдовші' }),
  ])

  function filtered() {
    let rows = query
      ? all.filter((m) =>
        m.text.toLowerCase().includes(query) ||
        m.senderName.toLowerCase().includes(query) ||
        m.senderUsername.toLowerCase().includes(query))
      : all.slice()

    switch (sort) {
      case 'old': rows.sort((a, b) => new Date(a.date) - new Date(b.date)); break
      case 'views': rows.sort((a, b) => (b.views ?? 0) - (a.views ?? 0)); break
      case 'reactions': rows.sort((a, b) => (b.reactions ?? 0) - (a.reactions ?? 0)); break
      case 'long': rows.sort((a, b) => b.text.length - a.text.length); break
      default: rows.sort((a, b) => new Date(b.date) - new Date(a.date))
    }
    return rows
  }

  function renderList() {
    const rows = filtered()
    const slice = rows.slice(0, shown)
    listHost.replaceChildren()

    if (!rows.length) {
      listHost.append(empty('🔍', 'Нічого не знайдено', 'Спробуй інший запит'))
      return
    }

    const list = el('div', { class: 'section__body' }, slice.map((m) => messageCard(m, meta?.peer, query)))
    listHost.append(list)

    if (rows.length > shown) {
      listHost.append(el('button', {
        class: 'btn btn--block', type: 'button', style: 'margin-top:10px',
        text: `Показати ще ${fmtNumber(Math.min(PAGE, rows.length - shown))} з ${fmtNumber(rows.length)}`,
        onclick: () => { shown += PAGE; renderList() },
      }))
    }
  }

  host.append(
    summaryCard(all, meta),
    el('div', { class: 'row', style: 'gap:8px' }, [
      el('button', { class: 'btn btn--sm', type: 'button', text: '📊 Статистика', onclick: () => showStats(all, meta) }),
      el('button', { class: 'btn btn--sm btn--primary', type: 'button', text: '⬇ Експорт', onclick: () => exportSheet('messages', all, meta) }),
    ]),
    el('div', { class: 'row', style: 'margin-top:12px;gap:8px' }, [search, sortSel]),
    listHost
  )

  renderList()
  return host
}

function summaryCard(rows, meta) {
  const dates = rows.map((r) => new Date(r.date)).filter((d) => !Number.isNaN(d.getTime()))
  const from = dates.length ? new Date(Math.min(...dates)) : null
  const to = dates.length ? new Date(Math.max(...dates)) : null
  const withMedia = rows.filter((r) => r.media).length

  return el('div', { class: 'card' }, [
    el('div', { class: 'stat-grid' }, [
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value', text: fmtNumber(rows.length) }),
        el('div', { class: 'stat__label', text: 'Знайдено' }),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value', text: fmtNumber(meta?.scanned ?? rows.length) }),
        el('div', { class: 'stat__label', text: 'Переглянуто' }),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value', text: fmtNumber(withMedia) }),
        el('div', { class: 'stat__label', text: 'З медіа' }),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value', text: meta?.finishedAt && meta?.startedAt ? `${Math.round((meta.finishedAt - meta.startedAt) / 1000)}с` : '—' }),
        el('div', { class: 'stat__label', text: 'Тривалість' }),
      ]),
    ]),
    from && to ? el('p', { class: 'muted small center', style: 'margin:12px 0 0', text: `${fmtDate(from, false)} — ${fmtDate(to, false)}` }) : null,
    meta?.cancelled ? el('p', { class: 'muted small center', style: 'margin:6px 0 0', text: '⏸ Збір було зупинено вручну' }) : null,
  ])
}

function highlight(text, query) {
  const safe = escapeHtml(text)
  if (!query) return safe
  try {
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    return safe.replace(re, '<mark>$1</mark>')
  } catch {
    return safe
  }
}

function messageCard(m, peer, query) {
  const textNode = m.text
    ? el('div', { class: 'msg__text is-clamped', html: highlight(m.text, query) })
    : el('div', { class: 'msg__text muted', text: m.media ? '(без підпису)' : '(порожнє повідомлення)' })

  const more = m.text.length > 260
    ? el('button', {
      class: 'msg__more', type: 'button', text: 'Показати повністю',
      onclick: (e) => {
        const clamped = textNode.classList.toggle('is-clamped')
        e.target.textContent = clamped ? 'Показати повністю' : 'Згорнути'
      },
    })
    : null

  const meta = el('div', { class: 'msg__meta' }, [
    m.views != null ? el('span', { text: `👁 ${fmtNumber(m.views)}` }) : null,
    m.forwards ? el('span', { text: `↗ ${fmtNumber(m.forwards)}` }) : null,
    m.reactions ? el('span', { text: `❤ ${fmtNumber(m.reactions)}` }) : null,
    m.replies ? el('span', { text: `💬 ${fmtNumber(m.replies)}` }) : null,
    m.media ? el('span', {
      text: `${MEDIA_ICON[m.media] || '📎'} ${m.fileName || m.media}${m.fileSize ? ` · ${fmtBytes(m.fileSize)}` : ''}`,
    }) : null,
    m.link ? el('a', { href: m.link, target: '_blank', rel: 'noopener', text: 'Відкрити ↗' }) : null,
    el('button', {
      class: 'msg__more', type: 'button', text: 'Ще…',
      onclick: () => messageActions(m, peer),
    }),
  ])

  return el('article', { class: 'msg' }, [
    el('div', { class: 'msg__head' }, [
      el('span', { class: 'msg__author', text: m.senderName || (m.senderUsername ? `@${m.senderUsername}` : m.senderId || 'Автор невідомий') }),
      el('span', { class: 'msg__date', text: fmtDate(m.date) }),
    ]),
    textNode,
    more,
    meta,
  ])
}

async function messageActions(m, peer) {
  const actions = el('div', { class: 'stack' }, [
    el('button', {
      class: 'btn btn--block', type: 'button', text: '📋 Копіювати текст',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(m.text || '')
          toast('Скопійовано', 'ok')
        } catch { toast('Браузер не дозволив копіювання', 'error') }
      },
    }),
    m.link ? el('a', { class: 'btn btn--block', href: m.link, target: '_blank', rel: 'noopener', text: '↗ Відкрити в Telegram' }) : null,
    m.media ? el('button', {
      class: 'btn btn--block', type: 'button', text: `⬇ Завантажити ${m.fileName || m.media}`,
      onclick: (e) => downloadMedia(e.target, m, peer),
    }) : null,
    el('div', { class: 'card', style: 'margin:0' }, [
      el('p', { class: 'muted small', text: `ID: ${m.id}` }),
      m.senderId ? el('p', { class: 'muted small', text: `ID автора: ${m.senderId}` }) : null,
      m.urls?.length ? el('p', { class: 'small', html: `Посилання:<br>${m.urls.map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(u)}</a>`).join('<br>')}` }) : null,
      m.hashtags?.length ? el('p', { class: 'muted small', text: `Хештеги: ${m.hashtags.join(' ')}` }) : null,
      m.fwdFrom ? el('p', { class: 'muted small', text: `Переслано від: ${m.fwdFrom}` }) : null,
    ]),
  ])

  modal({ title: `Повідомлення #${m.id}`, body: actions, actions: [{ label: 'Закрити', value: true }] })
}

async function downloadMedia(btn, m, peer) {
  if (!peer) return toast('Немає інформації про чат', 'error')
  const original = btn.textContent
  btn.disabled = true
  try {
    const { blob, name } = await tg.downloadMessageMedia(peer, m.id, (received, total) => {
      btn.textContent = total ? `⬇ ${Math.round((received / total) * 100)}%` : '⬇ Завантаження…'
    })
    if (canShareFiles(blob, name)) {
      try {
        await shareBlob(blob, name, name)
      } catch {
        downloadBlob(blob, name)
      }
    } else {
      downloadBlob(blob, name)
    }
    toast('Файл готовий', 'ok')
  } catch (e) {
    console.error(e)
    toast(tg.describeError(e), 'error', 5000)
  } finally {
    btn.disabled = false
    btn.textContent = original
  }
}

/* ------------------------------------------------------------ учасники --- */

function membersView(ctx) {
  const all = runtime.members
  const meta = runtime.membersMeta
  let shown = PAGE
  let query = ''

  const host = el('div')
  const listHost = el('section', { class: 'section' }, [])

  const search = textInput({
    type: 'search', placeholder: 'Пошук серед учасників…',
    oninput: debounce((e) => { query = e.target.value.trim().toLowerCase(); shown = PAGE; renderList() }, 180),
  })

  function renderList() {
    const rows = query
      ? all.filter((u) => u.name.toLowerCase().includes(query) || u.username.toLowerCase().includes(query) || u.id.includes(query))
      : all
    listHost.replaceChildren()
    if (!rows.length) return listHost.append(empty('🔍', 'Нічого не знайдено'))

    listHost.append(el('div', { class: 'section__body' }, rows.slice(0, shown).map((u) =>
      el('div', { class: 'list-item' }, [
        el('div', { class: 'avatar avatar--sm', style: `background:${avatarColor(u.id)}`, text: initials(u.name || u.username) }),
        el('div', { class: 'list-item__body' }, [
          el('div', { class: 'list-item__title', text: u.name || u.username || u.id }),
          el('div', { class: 'list-item__sub', text: [
            u.username ? `@${u.username}` : `ID ${u.id}`,
            u.phone ? `📞 ${u.phone}` : '',
            u.isBot ? 'бот' : '',
            u.isPremium ? 'premium' : '',
            u.status,
          ].filter(Boolean).join(' · ') }),
        ]),
        u.link ? el('a', { class: 'list-item__right', href: u.link, target: '_blank', rel: 'noopener', text: '↗' }) : null,
      ])
    )))

    if (rows.length > shown) {
      listHost.append(el('button', {
        class: 'btn btn--block', type: 'button', style: 'margin-top:10px',
        text: `Показати ще (${fmtNumber(rows.length - shown)})`,
        onclick: () => { shown += PAGE; renderList() },
      }))
    }
  }

  const bots = all.filter((u) => u.isBot).length
  const withPhone = all.filter((u) => u.phone).length
  const withUsername = all.filter((u) => u.username).length

  host.append(
    el('div', { class: 'card' }, [
      el('div', { class: 'stat-grid' }, [
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__value', text: fmtNumber(all.length) }),
          el('div', { class: 'stat__label', text: 'Зібрано' }),
        ]),
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__value', text: meta?.total ? fmtNumber(meta.total) : '—' }),
          el('div', { class: 'stat__label', text: 'Усього в чаті' }),
        ]),
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__value', text: fmtNumber(withUsername) }),
          el('div', { class: 'stat__label', text: 'З username' }),
        ]),
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__value', text: fmtNumber(bots) }),
          el('div', { class: 'stat__label', text: 'Ботів' }),
        ]),
      ]),
      withPhone ? el('p', { class: 'muted small center', style: 'margin:12px 0 0', text: `Видимих номерів: ${fmtNumber(withPhone)}` }) : null,
    ]),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn btn--sm btn--primary', type: 'button', text: '⬇ Експорт', onclick: () => exportSheet('members', all, meta) }),
    ]),
    el('div', { style: 'margin-top:12px' }, [search]),
    listHost
  )

  renderList()
  return host
}

/* ---------------------------------------------------------- статистика --- */

function showStats(rows, meta) {
  const byDay = new Map()
  const byAuthor = new Map()
  const byHour = new Array(24).fill(0)
  const words = new Map()
  const media = new Map()
  let totalViews = 0
  let links = 0

  const STOP = new Set(['este', 'що', 'як', 'для', 'або', 'але', 'так', 'все', 'вже', 'ще', 'цей', 'той', 'він', 'вона', 'воно', 'вони', 'наш', 'ваш', 'the', 'and', 'for', 'you', 'that', 'this', 'with', 'від', 'про', 'при', 'над', 'під', 'між', 'без', 'щоб', 'коли', 'якщо', 'тому', 'його', 'її', 'їх', 'ми', 'ви', 'на', 'не', 'до', 'за', 'із', 'зі', 'по'])

  for (const m of rows) {
    const d = new Date(m.date)
    if (!Number.isNaN(d.getTime())) {
      const key = d.toISOString().slice(0, 10)
      byDay.set(key, (byDay.get(key) || 0) + 1)
      byHour[d.getHours()]++
    }
    const author = m.senderName || (m.senderUsername ? `@${m.senderUsername}` : m.senderId || '—')
    byAuthor.set(author, (byAuthor.get(author) || 0) + 1)
    if (m.media) media.set(m.media, (media.get(m.media) || 0) + 1)
    totalViews += m.views || 0
    links += m.urls?.length || 0
    for (const w of String(m.text || '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []) {
      if (!STOP.has(w)) words.set(w, (words.get(w) || 0) + 1)
    }
  }

  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-30)
  const maxDay = Math.max(1, ...days.map(([, v]) => v))

  const top = (map, n = 8) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
  const rankList = (entries) => {
    const max = Math.max(1, ...entries.map(([, v]) => v))
    return el('div', {}, entries.map(([k, v]) => el('div', { class: 'rank' }, [
      el('span', { style: 'flex:0 0 40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: k }),
      el('span', { class: 'rank__bar' }, [el('span', { class: 'rank__fill', style: `width:${(v / max) * 100}%` })]),
      el('span', { class: 'rank__val', text: fmtNumber(v) }),
    ])))
  }

  const body = el('div', { class: 'stack small' }, [
    el('div', { class: 'stat-grid' }, [
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value', text: fmtNumber(totalViews) }),
        el('div', { class: 'stat__label', text: 'Переглядів разом' }),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value', text: fmtNumber(byAuthor.size) }),
        el('div', { class: 'stat__label', text: 'Авторів' }),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value', text: fmtNumber(links) }),
        el('div', { class: 'stat__label', text: 'Посилань' }),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value', text: fmtNumber(Math.round(rows.reduce((s, m) => s + m.text.length, 0) / (rows.length || 1))) }),
        el('div', { class: 'stat__label', text: 'Символів у середньому' }),
      ]),
    ]),
    days.length > 1 ? el('div', {}, [
      el('h4', { style: 'margin:6px 0 0', text: 'Активність за днями' }),
      el('div', { class: 'bars' }, days.map(([day, v]) =>
        el('div', { class: 'bars__bar', style: `height:${Math.max(4, (v / maxDay) * 100)}%`, title: `${day}: ${v}` })
      )),
      el('div', { class: 'row muted', style: 'font-size:11px;justify-content:space-between' }, [
        el('span', { text: days[0][0] }),
        el('span', { text: days[days.length - 1][0] }),
      ]),
    ]) : null,
    byAuthor.size > 1 ? el('div', {}, [
      el('h4', { style: 'margin:10px 0 0', text: 'Топ авторів' }),
      rankList(top(byAuthor)),
    ]) : null,
    words.size ? el('div', {}, [
      el('h4', { style: 'margin:10px 0 0', text: 'Часті слова' }),
      rankList(top(words, 10)),
    ]) : null,
    media.size ? el('div', {}, [
      el('h4', { style: 'margin:10px 0 0', text: 'Вкладення' }),
      rankList([...media.entries()].sort((a, b) => b[1] - a[1])),
    ]) : null,
  ])

  modal({ title: `Статистика · ${meta?.peer?.title || ''}`, body, actions: [{ label: 'Закрити', value: true }] })
}

/* -------------------------------------------------------------- експорт --- */

const FORMATS = [
  { value: 'csv', label: 'CSV', hint: 'Excel / Google Таблиці' },
  { value: 'json', label: 'JSON', hint: 'усі поля, для обробки' },
  { value: 'txt', label: 'TXT', hint: 'простий текст' },
  { value: 'html', label: 'HTML', hint: 'сторінка для читання' },
]

function exportSheet(kind, rows, meta) {
  const body = el('div', { class: 'stack' }, [
    el('p', { class: 'muted small', text: `${fmtNumber(rows.length)} записів · ${meta?.peer?.title || ''}` }),
    ...FORMATS.map((f) => el('div', { class: 'row', style: 'gap:8px' }, [
      el('div', { style: 'flex:1' }, [
        el('div', { text: f.label }),
        el('div', { class: 'muted small', text: f.hint }),
      ]),
      el('button', {
        class: 'btn btn--sm', type: 'button', text: '⬇ Зберегти',
        onclick: () => doExport(kind, f.value, rows, meta, false),
      }),
      navigator.canShare ? el('button', {
        class: 'btn btn--sm', type: 'button', text: '↗',
        onclick: () => doExport(kind, f.value, rows, meta, true),
      }) : null,
    ])),
    el('p', { class: 'muted small', text: 'Кнопка ↗ відкриває системне «Поділитися» — зручно, щоб зберегти у «Файли» чи надіслати собі в Telegram.' }),
  ])

  modal({ title: 'Експорт', body, actions: [{ label: 'Закрити', value: true }] })
}

async function doExport(kind, format, rows, meta, share) {
  try {
    const { blob, name } = buildFile(kind, format, rows, meta)
    if (share && canShareFiles(blob, name)) {
      await shareBlob(blob, name, name)
      return
    }
    downloadBlob(blob, name)
    toast(`Збережено: ${name}`, 'ok', 4000)
  } catch (e) {
    if (e?.name === 'AbortError') return
    console.error(e)
    toast(`Не вдалось експортувати: ${e.message}`, 'error')
  }
}
