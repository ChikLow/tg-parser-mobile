// Вкладка «Ще»: акаунт, дані, встановлення на домашній екран, довідка.

import { el, switchRow, toast, confirmDialog, modal, fmtNumber, initials, avatarColor } from '../ui.js'
import { state, patch, wipe, runtime } from '../state.js'
import * as tg from '../tg.js'
import { getInstallPrompt, isStandalone } from '../install.js'

export function settingsScreen(ctx) {
  const me = runtime.me
  const body = el('div', { class: 'stack' })

  if (me) {
    body.append(el('div', { class: 'card row', style: 'gap:12px' }, [
      el('div', { class: 'avatar', style: `background:${avatarColor(me.id)}`, text: initials(me.name) }),
      el('div', { style: 'flex:1;min-width:0' }, [
        el('div', { class: 'list-item__title', text: me.name || 'Акаунт' }),
        el('div', { class: 'list-item__sub', text: [me.username ? `@${me.username}` : '', me.phone ? `+${me.phone}` : '', `ID ${me.id}`].filter(Boolean).join(' · ') }),
      ]),
    ]))
  }

  body.append(installSection())

  body.append(el('section', { class: 'section' }, [
    el('div', { class: 'section__head' }, [el('h2', { class: 'section__title', text: 'Дані на пристрої' })]),
    el('div', { class: 'section__body' }, [
      switchRow({
        label: 'Пам\'ятати вхід',
        hint: 'Вимкни, якщо телефоном користується хтось іще: сесія зникне після закриття вкладки',
        checked: state.rememberSession,
        onchange: (v) => {
          patch({ rememberSession: v })
          toast(v ? 'Сесія зберігатиметься на пристрої' : 'Сесія зникне після закриття', 'ok')
        },
      }),
      row('Збережених чатів', `${fmtNumber(state.dialogs?.length || 0)}`, 'Очистити', async () => {
        patch({ dialogs: [], dialogsAt: 0 })
        toast('Список чатів очищено', 'ok')
        ctx.render()
      }),
      row('Результатів у пам\'яті',
        `${fmtNumber(runtime.results?.length || 0)} повідомл. · ${fmtNumber(runtime.members?.length || 0)} учасн.`,
        'Очистити', async () => {
          runtime.results = []
          runtime.members = []
          runtime.resultsMeta = null
          runtime.membersMeta = null
          toast('Результати очищено', 'ok')
          ctx.render()
        }),
    ]),
  ]))

  body.append(el('section', { class: 'section' }, [
    el('div', { class: 'section__head' }, [el('h2', { class: 'section__title', text: 'Довідка' })]),
    el('div', { class: 'section__body' }, [
      linkRow('❓ Як це працює', showHowItWorks),
      linkRow('🛡 Приватність і безпека', showPrivacy),
      linkRow('⚠️ Обмеження Telegram', showLimits),
    ]),
  ]))

  body.append(el('div', { class: 'stack', style: 'margin-top:8px' }, [
    el('button', {
      class: 'btn btn--danger btn--block', type: 'button', text: 'Вийти з акаунта',
      onclick: async () => {
        const ok = await confirmDialog('Вийти?', 'Сесію буде завершено, збережені результати зникнуть.', 'Вийти')
        if (!ok) return
        const t = toast('Виходимо…', 'info', 15000)
        try { await tg.logout({ revoke: true }) } catch (e) { console.warn(e) }
        t.remove()
        wipe({ keepCredentials: true })
        location.reload()
      },
    }),
    el('button', {
      class: 'btn btn--ghost btn--block', type: 'button', text: 'Стерти всі дані застосунку',
      onclick: async () => {
        const ok = await confirmDialog('Стерти все?', 'Буде видалено ключі API, сесію, список чатів і результати з цього пристрою.', 'Стерти')
        if (!ok) return
        try { await tg.logout({ revoke: false }) } catch (e) { console.warn(e) }
        wipe()
        location.reload()
      },
    }),
    el('p', { class: 'muted small center', text: `TG Parser · збірка ${__APP_VERSION__}` }),
  ]))

  return { title: 'Ще', body }
}

function row(label, value, actionLabel, onAction) {
  return el('div', { class: 'switch-row' }, [
    el('span', {}, [
      el('span', { class: 'switch-row__label', text: label }),
      el('span', { class: 'switch-row__hint', text: value }),
    ]),
    el('button', { class: 'btn btn--sm', type: 'button', text: actionLabel, onclick: onAction }),
  ])
}

function linkRow(label, onClick) {
  return el('button', { class: 'list-item', type: 'button', onclick: onClick }, [
    el('div', { class: 'list-item__body' }, [el('div', { class: 'list-item__title', text: label })]),
    el('div', { class: 'list-item__right', text: '›' }),
  ])
}

/* ------------------------------------------------ встановлення на телефон --- */

function installSection() {
  if (isStandalone()) {
    return el('div', { class: 'card' }, [
      el('p', { class: 'small', text: '✅ Застосунок запущено з домашнього екрана.' }),
    ])
  }

  const prompt = getInstallPrompt()
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)

  return el('div', { class: 'card card--accent' }, [
    el('div', { style: 'font-weight:600;margin-bottom:6px', text: '📲 Додати на домашній екран' }),
    el('p', { class: 'muted small', text: isIOS
      ? 'Натисни «Поділитися» внизу Safari → «На екран «Додому»» → «Додати».'
      : 'Застосунок працюватиме у власному вікні, без адресного рядка, і відкриватиметься як звичайна програма.' }),
    prompt ? el('button', {
      class: 'btn btn--primary btn--block', type: 'button', text: 'Встановити', style: 'margin-top:10px',
      onclick: async () => {
        prompt.prompt()
        const { outcome } = await prompt.userChoice
        if (outcome === 'accepted') toast('Готово! Шукай іконку на домашньому екрані', 'ok')
      },
    }) : null,
  ])
}

/* ---------------------------------------------------------------- довідка --- */

function showHowItWorks() {
  modal({
    title: 'Як це працює',
    body: el('div', { class: 'stack small' }, [
      el('p', { text: 'Застосунок — це звичайна веб-сторінка, яка з\'єднується з серверами Telegram напряму з твого телефона (протокол MTProto через WebSocket). Проміжного сервера немає: ніхто, крім тебе й Telegram, не бачить твої дані.' }),
      el('p', { text: 'Вхід відбувається під твоїм акаунтом, тому парсити можна все, до чого ти маєш доступ: публічні канали, групи, приватні чати, де ти є учасником.' }),
      el('p', { text: 'Результати зберігаються в пам\'яті вкладки. Щоб не втратити — експортуй у CSV/JSON одразу після збору.' }),
    ]),
    actions: [{ label: 'Зрозуміло', value: true }],
  })
}

function showPrivacy() {
  modal({
    title: 'Приватність і безпека',
    body: el('div', { class: 'stack small' }, [
      el('p', { text: 'api_id, api_hash і ключ сесії зберігаються лише в локальному сховищі цього браузера. Вони не надсилаються нікуди, крім самого Telegram.' }),
      el('p', { text: 'Ключ сесії = доступ до акаунта. Не встановлюй застосунок на чужому телефоні й вимикай «Пам\'ятати вхід», якщо пристрій спільний.' }),
      el('p', { text: 'Будь-яку сесію можна відкликати в Telegram: Налаштування → Пристрої → завершити сеанс.' }),
      el('p', { text: 'Зібрані персональні дані (імена, телефони, ID) використовуй лише законно — правила Telegram і закон про персональні дані ніхто не скасовував.' }),
    ]),
    actions: [{ label: 'Зрозуміло', value: true }],
  })
}

function showLimits() {
  modal({
    title: 'Обмеження Telegram',
    body: el('div', { class: 'stack small' }, [
      el('p', { text: '• Занадто швидкі запити → Telegram відповідає FLOOD_WAIT і просить зачекати. Застосунок сам показує таймер і продовжує далі.' }),
      el('p', { text: '• Список учасників доступний не всюди: у великих каналах його бачать лише адміністратори, а Telegram віддає максимум ~10 000 профілів (звідси «глибокий пошук»).' }),
      el('p', { text: '• Номери телефонів видно лише тим, кому їх відкрито налаштуваннями приватності.' }),
      el('p', { text: '• Дуже інтенсивний парсинг новим акаунтом може призвести до обмежень. Став паузу 1–2 с і не збирай мільйони повідомлень за раз.' }),
    ]),
    actions: [{ label: 'Зрозуміло', value: true }],
  })
}
