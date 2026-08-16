// Список чатів акаунта + пошук + додавання за посиланням/username.

import {
  el, textInput, toast, spinner, empty, initials, avatarColor, fmtNumber, debounce, modal,
} from '../ui.js'
import { state, patch, runtime } from '../state.js'
import * as tg from '../tg.js'

const TYPE_LABEL = {
  channel: 'Канал',
  supergroup: 'Супергрупа',
  group: 'Група',
  user: 'Особистий чат',
  bot: 'Бот',
  chat: 'Чат',
}

const TYPE_ICON = {
  channel: '📢', supergroup: '👥', group: '👥', user: '👤', bot: '🤖', chat: '💬',
}

const FILTERS = [
  { value: 'all', label: 'Усі' },
  { value: 'channel', label: 'Канали' },
  { value: 'group', label: 'Групи' },
  { value: 'user', label: 'Люди' },
]

export function chatsScreen(ctx) {
  const body = el('div')
  const listHost = el('div', { class: 'section__body' })
  let query = ''
  let filter = 'all'

  const search = textInput({
    type: 'search', placeholder: 'Пошук чату або @username…',
    oninput: debounce((e) => { query = e.target.value.trim().toLowerCase(); renderList() }, 200),
  })

  const chips = el('div', { class: 'row row--wrap', style: 'margin: 10px 2px' },
    FILTERS.map((f) =>
      el('button', {
        class: `chip ${f.value === filter ? 'is-active' : ''}`,
        type: 'button', text: f.label, dataset: { value: f.value },
        onclick: (e) => {
          filter = f.value
          for (const c of chips.children) c.classList.toggle('is-active', c.dataset.value === filter)
          renderList()
        },
      })
    )
  )

  body.append(
    el('div', { class: 'stack' }, [
      search,
      el('div', { class: 'row', style: 'gap:8px' }, [
        el('button', {
          class: 'btn btn--sm', type: 'button', text: '↻ Оновити список', onclick: () => load(true),
        }),
        el('button', {
          class: 'btn btn--sm', type: 'button', text: '＋ За посиланням', onclick: () => addByLink(ctx),
        }),
      ]),
    ]),
    chips,
    el('section', { class: 'section' }, [listHost])
  )

  function renderList() {
    const all = state.dialogs || []
    const filtered = all.filter((d) => {
      if (filter === 'channel' && d.type !== 'channel') return false
      if (filter === 'group' && !['group', 'supergroup'].includes(d.type)) return false
      if (filter === 'user' && !['user', 'bot'].includes(d.type)) return false
      if (!query) return true
      return d.title.toLowerCase().includes(query) || d.username.toLowerCase().includes(query)
    })

    listHost.replaceChildren()
    if (!filtered.length) {
      listHost.append(all.length
        ? empty('🔍', 'Нічого не знайдено', 'Спробуй інший запит або додай чат за посиланням')
        : empty('💬', 'Список порожній', 'Натисни «Оновити список»'))
      return
    }
    for (const d of filtered.slice(0, 400)) listHost.append(chatRow(ctx, d))
  }

  async function load(force = false) {
    const fresh = Date.now() - (state.dialogsAt || 0) < 5 * 60 * 1000
    if (!force && fresh && state.dialogs?.length) return renderList()

    listHost.replaceChildren(spinner('Завантажуємо чати…'))
    try {
      await tg.loadDialogs({ limit: 400 })
      renderList()
    } catch (e) {
      console.error(e)
      listHost.replaceChildren(empty('⚠️', 'Не вдалось завантажити', tg.describeError(e)))
    }
  }

  load()

  return {
    title: 'Чати',
    subtitle: runtime.me ? `${runtime.me.name}${runtime.me.username ? ` · @${runtime.me.username}` : ''}` : '',
    body,
  }
}

function chatRow(ctx, d) {
  return el('button', {
    class: 'list-item', type: 'button',
    onclick: () => {
      runtime.peer = d
      toast(`Обрано: ${d.title}`, 'ok', 1600)
      ctx.go('parse')
    },
  }, [
    el('div', { class: 'avatar', style: `background:${avatarColor(d.id)}`, text: initials(d.title) }),
    el('div', { class: 'list-item__body' }, [
      el('div', { class: 'list-item__title', text: d.title }),
      el('div', { class: 'list-item__sub', text: [
        `${TYPE_ICON[d.type] || '💬'} ${TYPE_LABEL[d.type] || 'Чат'}`,
        d.username ? `@${d.username}` : '',
        d.members ? `${fmtNumber(d.members)} учасн.` : '',
      ].filter(Boolean).join(' · ') }),
    ]),
    el('div', { class: 'list-item__right', text: '›' }),
  ])
}

async function addByLink(ctx) {
  const input = textInput({ placeholder: '@channel або https://t.me/channel' })
  const ok = await modal({
    title: 'Чат за посиланням',
    body: el('div', { class: 'stack' }, [
      input,
      el('p', { class: 'muted small', text: 'Працює для публічних каналів і груп. Для приватних — спочатку приєднайся до них у Telegram.' }),
    ]),
    actions: [
      { label: 'Скасувати', value: false },
      { label: 'Знайти', value: true, kind: 'primary' },
    ],
  })
  if (!ok || !input.value.trim()) return

  const t = toast('Шукаємо чат…', 'info', 30000)
  try {
    const peer = await tg.peerFromInput(input.value)
    t.remove()
    const dialogs = state.dialogs || []
    if (!dialogs.some((d) => d.id === peer.id)) patch({ dialogs: [peer, ...dialogs] })
    runtime.peer = peer
    toast(`Обрано: ${peer.title}`, 'ok')
    ctx.go('parse')
  } catch (e) {
    t.remove()
    console.error(e)
    toast(tg.describeError(e), 'error', 6000)
  }
}
