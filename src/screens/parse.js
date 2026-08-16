// Налаштування парсингу + виконання із живим прогресом.

import {
  el, field, textInput, switchRow, toast, empty, initials, avatarColor,
  fmtNumber, fmtDuration, confirmDialog,
} from '../ui.js'
import { state, patch, runtime } from '../state.js'
import * as tg from '../tg.js'

let job = null                 // поточне завдання (живе між перемиканнями вкладок)
const listeners = new Set()

function notify() {
  for (const fn of listeners) {
    try { fn() } catch (e) { console.warn(e) }
  }
}

export function isRunning() {
  return Boolean(job && !job.done)
}

export function parseScreen(ctx) {
  if (job && !job.done) return progressView(ctx)

  const peer = runtime.peer
  const body = el('div', { class: 'stack' })

  if (!peer) {
    body.append(empty('👈', 'Спочатку обери чат', 'Перейди на вкладку «Чати» і торкнись потрібного каналу або групи'))
    body.append(el('button', {
      class: 'btn btn--primary btn--block', type: 'button', text: 'До списку чатів',
      onclick: () => ctx.go('chats'),
    }))
    return { title: 'Парсер', body }
  }

  const mode = ctx.params?.mode || 'messages'
  body.append(peerCard(ctx, peer))
  body.append(modeSwitch(ctx, mode))
  body.append(mode === 'messages' ? messagesForm(ctx, peer) : membersForm(ctx, peer))

  return { title: 'Парсер', subtitle: peer.title, body }
}

function peerCard(ctx, peer) {
  return el('div', { class: 'card row', style: 'gap:12px' }, [
    el('div', { class: 'avatar', style: `background:${avatarColor(peer.id)}`, text: initials(peer.title) }),
    el('div', { style: 'flex:1;min-width:0' }, [
      el('div', { class: 'list-item__title', text: peer.title }),
      el('div', { class: 'list-item__sub', text: [
        peer.username ? `@${peer.username}` : peer.id,
        peer.members ? `${fmtNumber(peer.members)} учасн.` : '',
      ].filter(Boolean).join(' · ') }),
    ]),
    el('button', { class: 'btn btn--sm', type: 'button', text: 'Змінити', onclick: () => ctx.go('chats') }),
  ])
}

function modeSwitch(ctx, mode) {
  const mk = (value, label) => el('button', {
    class: `chip ${mode === value ? 'is-active' : ''}`, type: 'button', text: label,
    onclick: () => ctx.go('parse', { mode: value }),
  })
  return el('div', { class: 'row' }, [
    mk('messages', '💬 Повідомлення'),
    mk('members', '👥 Учасники'),
  ])
}

/* ------------------------------------------------- форма повідомлень --- */

function messagesForm(ctx, peer) {
  const p = state.lastParse

  const limit = textInput({ inputmode: 'numeric', value: String(p.limit ?? 500), placeholder: '500' })
  const search = textInput({ value: p.search || '', placeholder: 'слово для пошуку на сервері' })
  const keywords = textInput({ value: p.keywords || '', placeholder: 'ціна, купити, знижка' })
  const keywordMode = el('select', { class: 'input' }, [
    el('option', { value: 'any', text: 'Будь-яке зі слів' }),
    el('option', { value: 'all', text: 'Усі слова одразу' }),
    el('option', { value: 'regex', text: 'Регулярний вираз' }),
  ])
  keywordMode.value = p.keywordMode || 'any'

  const mediaKind = el('select', { class: 'input' },
    tg.MEDIA_KINDS.map((k) => el('option', { value: k.value, text: k.label })))
  mediaKind.value = p.mediaKind || ''

  const dateFrom = el('input', { class: 'input', type: 'date', value: p.dateFrom || '' })
  const dateTo = el('input', { class: 'input', type: 'date', value: p.dateTo || '' })
  const minViews = textInput({ inputmode: 'numeric', value: p.minViews || '', placeholder: 'напр. 1000' })
  const fromUser = textInput({ value: p.fromUser || '', placeholder: '@username автора' })
  const waitTime = textInput({ inputmode: 'decimal', value: String(p.waitTime ?? 1), placeholder: '1' })

  const flags = { mediaOnly: !!p.mediaOnly, textOnly: !!p.textOnly, skipService: p.skipService !== false }

  const advanced = el('div', { class: 'section', hidden: true }, [
    el('div', { class: 'section__body' }, [
      field({ label: 'Тільки від автора', input: fromUser, hint: '@username або ID учасника' }),
      field({ label: 'Мінімум переглядів', input: minViews }),
      field({
        label: 'Пауза між запитами, с', input: waitTime,
        hint: 'Більша пауза = менший ризик обмежень Telegram при великих обсягах',
      }),
      switchRow({
        label: 'Пропускати службові', hint: 'Вхід/вихід учасників, зміна фото тощо',
        checked: flags.skipService, onchange: (v) => { flags.skipService = v },
      }),
    ]),
  ])

  const runBtn = el('button', { class: 'btn btn--primary btn--block', type: 'submit', text: '▶ Почати парсинг' })

  const form = el('form', { class: 'stack', onsubmit: onSubmit }, [
    el('section', { class: 'section' }, [
      el('div', { class: 'section__head' }, [el('h2', { class: 'section__title', text: 'Обсяг' })]),
      el('div', { class: 'section__body' }, [
        field({
          label: 'Скільки останніх повідомлень переглянути', input: limit,
          hint: '0 — усю історію (може зайняти багато часу)',
        }),
        el('div', { class: 'field' }, [
          el('span', { class: 'field__label', text: 'Період' }),
          el('div', { class: 'grid-2' }, [dateFrom, dateTo]),
          el('span', { class: 'field__hint', text: 'Від / до. Можна лишити порожнім' }),
        ]),
      ]),
    ]),
    el('section', { class: 'section' }, [
      el('div', { class: 'section__head' }, [el('h2', { class: 'section__title', text: 'Фільтри' })]),
      el('div', { class: 'section__body' }, [
        field({
          label: 'Пошук на сервері Telegram', input: search,
          hint: 'Швидко: Telegram сам віддає лише повідомлення з цим словом',
        }),
        field({ label: 'Ключові слова (через кому)', input: keywords }),
        field({ label: 'Як шукати ключові слова', input: keywordMode }),
        field({ label: 'Тип вкладення', input: mediaKind }),
        switchRow({
          label: 'Тільки з медіа', checked: flags.mediaOnly,
          onchange: (v) => { flags.mediaOnly = v },
        }),
        switchRow({
          label: 'Тільки з текстом', checked: flags.textOnly,
          onchange: (v) => { flags.textOnly = v },
        }),
      ]),
    ]),
    el('button', {
      class: 'btn btn--ghost btn--block', type: 'button', text: '⚙️ Додаткові налаштування',
      onclick: (e) => {
        advanced.hidden = !advanced.hidden
        e.target.textContent = advanced.hidden ? '⚙️ Додаткові налаштування' : '⚙️ Згорнути';
      },
    }),
    advanced,
    runBtn,
  ])

  async function onSubmit(e) {
    e.preventDefault()
    const params = {
      limit: Math.max(0, parseInt(limit.value || '0', 10) || 0),
      search: search.value.trim(),
      keywords: keywords.value.trim(),
      keywordMode: keywordMode.value,
      mediaKind: mediaKind.value,
      mediaOnly: flags.mediaOnly,
      textOnly: flags.textOnly,
      minViews: minViews.value.trim(),
      fromUser: fromUser.value.trim(),
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      skipService: flags.skipService,
      waitTime: Number(waitTime.value) || 0,
    }

    if (params.keywordMode === 'regex' && params.keywords) {
      try { new RegExp(params.keywords, 'i') } catch (err) {
        return toast(`Некоректний регулярний вираз: ${err.message}`, 'error', 5000)
      }
    }
    if (params.limit === 0 || params.limit > 20000) {
      const ok = await confirmDialog(
        'Великий обсяг',
        params.limit === 0
          ? 'Буде переглянуто всю історію чату. На великих каналах це десятки хвилин і Telegram може тимчасово обмежити запити. Продовжити?'
          : `Буде переглянуто до ${fmtNumber(params.limit)} повідомлень. Це може зайняти багато часу. Продовжити?`,
        'Так, почати', 'primary'
      )
      if (!ok) return
    }

    patch({ lastParse: { ...state.lastParse, ...params } })
    startJob(ctx, 'messages', params, peer)
  }

  return form
}

/* ---------------------------------------------------- форма учасників --- */

function membersForm(ctx, peer) {
  const limit = textInput({ inputmode: 'numeric', value: '5000', placeholder: '5000' })
  const flags = { deep: false, skipBots: false, skipDeleted: true }
  const runBtn = el('button', { class: 'btn btn--primary btn--block', type: 'submit', text: '▶ Зібрати учасників' })

  const canWork = ['group', 'supergroup', 'channel'].includes(peer.type)

  const form = el('form', { class: 'stack', onsubmit: onSubmit }, [
    !canWork ? el('div', { class: 'card card--warn' }, [
      el('p', { class: 'small', text: 'Учасників можна зібрати лише в групах і каналах.' }),
    ]) : null,
    el('div', { class: 'card card--warn' }, [
      el('p', { class: 'small', text: 'Telegram віддає список учасників лише там, де він відкритий для тебе. У більшості каналів потрібні права адміністратора — інакше буде помилка доступу.' }),
    ]),
    el('section', { class: 'section' }, [
      el('div', { class: 'section__body' }, [
        field({ label: 'Максимум учасників', input: limit, hint: '0 — скільки віддасть Telegram' }),
        switchRow({
          label: 'Глибокий пошук', hint: 'Перебирає запити за літерами — дістає більше 10 000, але значно довше',
          checked: flags.deep, onchange: (v) => { flags.deep = v },
        }),
        switchRow({ label: 'Пропускати ботів', checked: flags.skipBots, onchange: (v) => { flags.skipBots = v } }),
        switchRow({ label: 'Пропускати видалені акаунти', checked: flags.skipDeleted, onchange: (v) => { flags.skipDeleted = v } }),
      ]),
    ]),
    runBtn,
  ])

  function onSubmit(e) {
    e.preventDefault()
    startJob(ctx, 'members', {
      limit: Math.max(0, parseInt(limit.value || '0', 10) || 0),
      deep: flags.deep,
      skipBots: flags.skipBots,
      skipDeleted: flags.skipDeleted,
      waitTime: state.lastParse.waitTime ?? 1,
    }, peer)
  }

  return form
}

/* --------------------------------------------------------- виконання --- */

function startJob(ctx, type, params, peer) {
  const token = { cancelled: false }
  job = {
    type, params, peer, token,
    progress: { scanned: 0, matched: 0, total: null, elapsed: 0 },
    flood: 0, retry: 0, done: false, error: null,
    startedAt: Date.now(),
  }

  const jobCtx = {
    token,
    onProgress: (p) => { job.progress = p; notify() },
    onFlood: (secs) => { job.flood = secs; notify() },
    onFloodTick: (left) => { job.flood = left; notify() },
    onRetry: (n) => { job.retry = n; notify() },
  }

  const run = type === 'messages'
    ? tg.parseMessages(peer, params, jobCtx)
    : tg.parseMembers(peer, params, jobCtx)

  run.then((res) => {
    job.done = true
    job.result = res
    if (type === 'messages') {
      runtime.results = res.items
      runtime.resultsMeta = { peer, params, scanned: res.scanned, total: res.total, startedAt: res.startedAt, finishedAt: res.finishedAt, cancelled: res.cancelled }
    } else {
      runtime.members = res.items
      runtime.membersMeta = { peer, params, total: res.total, startedAt: res.startedAt, finishedAt: res.finishedAt, cancelled: res.cancelled }
    }
    notify()
    toast(res.cancelled
      ? `Зупинено. Зібрано: ${fmtNumber(res.items.length)}`
      : `Готово! Зібрано: ${fmtNumber(res.items.length)}`, 'ok')
    ctx.go('results', { tab: type })
  }).catch((err) => {
    job.done = true
    job.error = err
    notify()
    if (err instanceof tg.Cancelled) {
      toast('Парсинг скасовано')
      ctx.go('parse')
    } else {
      console.error(err)
      ctx.render()
    }
  })

  ctx.render()
}

function progressView(ctx) {
  const host = el('div', { class: 'stack' })
  const rerender = () => {
    if (!document.contains(host)) {         // екран змінився — від'єднуємось
      clearInterval(timer)
      listeners.delete(rerender)
      return
    }
    host.replaceChildren(progressCard(ctx))
  }
  const timer = setInterval(rerender, 500)  // ще й оновлює лічильник часу
  listeners.add(rerender)
  rerender()

  return {
    title: job.type === 'messages' ? 'Парсинг повідомлень' : 'Збір учасників',
    subtitle: job.peer?.title || '',
    body: host,
  }
}

function progressCard(ctx) {
  const { progress, params, flood, error, done } = job
  const limit = Number(params.limit) || 0
  const pct = limit ? Math.min(100, Math.round((progress.scanned / limit) * 100)) : null
  const elapsed = Math.round((Date.now() - job.startedAt) / 1000)
  const speed = elapsed > 0 ? Math.round(progress.scanned / elapsed) : 0

  if (error && !(error instanceof tg.Cancelled)) {
    return el('div', { class: 'stack' }, [
      el('div', { class: 'card' }, [
        el('h3', { style: 'margin:0 0 8px', text: '⚠️ Помилка' }),
        el('p', { class: 'small', text: tg.describeError(error) }),
      ]),
      el('button', {
        class: 'btn btn--primary btn--block', type: 'button', text: 'Повернутись до налаштувань',
        onclick: () => { job = null; ctx.go('parse') },
      }),
    ])
  }

  return el('div', { class: 'stack' }, [
    el('div', { class: 'card' }, [
      el('div', { class: `progress ${pct === null ? 'progress--indeterminate' : ''}`, style: 'margin-bottom:14px' }, [
        el('div', { class: 'progress__bar', style: pct === null ? '' : `width:${pct}%` }),
      ]),
      el('div', { class: 'stat-grid' }, [
        stat(fmtNumber(progress.matched || 0), job.type === 'messages' ? 'Знайдено' : 'Учасників'),
        stat(fmtNumber(progress.scanned || 0), job.type === 'messages' ? 'Переглянуто' : 'Запитів'),
        stat(fmtDuration(elapsed), 'Час'),
        stat(`${fmtNumber(speed)}/с`, 'Швидкість'),
      ]),
      progress.lastDate
        ? el('p', { class: 'muted small center', style: 'margin:12px 0 0', text: `Дійшли до ${new Date(progress.lastDate).toLocaleDateString('uk-UA')}` })
        : null,
      progress.total
        ? el('p', { class: 'muted small center', style: 'margin:6px 0 0', text: `Усього в чаті: ${fmtNumber(progress.total)}` })
        : null,
    ]),
    flood > 0 ? el('div', { class: 'card card--warn' }, [
      el('p', { class: 'small', text: `Telegram просить зачекати. Продовжимо через ${flood} с — це нормально при великих обсягах.` }),
    ]) : null,
    job.retry ? el('div', { class: 'card card--warn' }, [
      el('p', { class: 'small', text: `Обрив зв'язку, перепідключення (спроба ${job.retry})…` }),
    ]) : null,
    el('button', {
      class: 'btn btn--danger btn--block', type: 'button',
      text: done ? 'Завершення…' : '■ Зупинити та зберегти зібране',
      disabled: done,
      onclick: () => { job.token.cancelled = true; notify() },
    }),
    el('p', { class: 'muted small center', text: 'Не закривай застосунок, поки триває збір. Зібране збережеться навіть після зупинки.' }),
  ])
}

function stat(value, label) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat__value', text: value }),
    el('div', { class: 'stat__label', text: label }),
  ])
}

export function resetJob() {
  job = null
}
