// Екран входу: api_id/api_hash → номер → код → (пароль 2FA).

import { el, field, textInput, toast, modal } from '../ui.js'
import { state, patch } from '../state.js'
import * as tg from '../tg.js'

export function loginScreen(ctx) {
  const step = ctx.params?.step || 'creds'
  const data = ctx.params?.data || {}

  const body = el('div', { class: 'stack' })

  if (step === 'creds') body.append(credsStep(ctx))
  else if (step === 'code') body.append(codeStep(ctx, data))
  else if (step === 'password') body.append(passwordStep(ctx, data))

  return {
    title: 'Вхід у Telegram',
    subtitle: step === 'creds' ? 'Крок 1 з 2' : step === 'code' ? 'Крок 2 з 2' : 'Двоетапна перевірка',
    plain: true,
    body,
  }
}

/* ---------------------------------------------------------- крок 1 --- */

function credsStep(ctx) {
  const apiId = textInput({ value: state.apiId, inputmode: 'numeric', placeholder: '1234567' })
  const apiHash = textInput({ value: state.apiHash, placeholder: '0123456789abcdef0123456789abcdef' })
  const phone = textInput({ value: state.lastPhone || '', type: 'tel', placeholder: '+380XXXXXXXXX' })
  const btn = el('button', { class: 'btn btn--primary btn--block', type: 'submit', text: 'Надіслати код' })

  const form = el('form', { class: 'stack', onsubmit: onSubmit }, [
    el('div', { class: 'card' }, [
      el('p', { class: 'muted', html: 'Застосунок працює прямо в браузері телефона: він з\'єднується з Telegram напряму, без проміжних серверів. Ключі та сесія зберігаються лише на цьому пристрої.' }),
    ]),
    el('div', { class: 'section' }, [
      el('div', { class: 'section__head' }, [
        el('h2', { class: 'section__title', text: 'Ключі Telegram API' }),
        el('button', { class: 'app-bar__action', type: 'button', text: 'Як отримати?', onclick: howTo }),
      ]),
      el('div', { class: 'section__body' }, [
        field({ label: 'api_id', input: apiId }),
        field({
          label: 'api_hash',
          input: apiHash,
          hint: 'Отримати можна на <a href="https://my.telegram.org/apps" target="_blank" rel="noopener">my.telegram.org/apps</a>',
        }),
      ]),
    ]),
    el('div', { class: 'section' }, [
      el('div', { class: 'section__body' }, [
        field({ label: 'Номер телефону', input: phone, hint: 'У міжнародному форматі, з кодом країни' }),
      ]),
    ]),
    btn,
  ])

  async function onSubmit(e) {
    e.preventDefault()
    const id = apiId.value.trim()
    const hash = apiHash.value.trim()
    const tel = phone.value.trim().replace(/[\s()-]/g, '')

    if (!/^\d{4,10}$/.test(id)) return toast('api_id — це число з my.telegram.org', 'error')
    if (!/^[a-f0-9]{32}$/i.test(hash)) return toast('api_hash — це 32 символи (літери a-f і цифри)', 'error')
    if (!/^\+?\d{8,15}$/.test(tel)) return toast('Перевір номер телефону', 'error')

    btn.disabled = true
    btn.textContent = 'З\'єднуємось…'
    try {
      patch({ apiId: id, apiHash: hash, lastPhone: tel, session: '' })
      tg.createClient({ apiId: id, apiHash: hash, session: '' })
      await tg.connect()
      const { phoneCodeHash, isCodeViaApp } = await tg.sendLoginCode(tel)
      ctx.go('login', { step: 'code', data: { phone: tel, phoneCodeHash, isCodeViaApp } })
    } catch (err) {
      console.error(err)
      toast(tg.describeError(err), 'error', 6000)
      btn.disabled = false
      btn.textContent = 'Надіслати код'
    }
  }

  return form
}

function howTo() {
  modal({
    title: 'Як отримати api_id та api_hash',
    body: el('div', { class: 'stack small' }, [
      el('p', { html: '1. Відкрий <a href="https://my.telegram.org/apps" target="_blank" rel="noopener">my.telegram.org/apps</a> і увійди за своїм номером.' }),
      el('p', { text: '2. Введи код, який прийде у Telegram.' }),
      el('p', { text: '3. Якщо застосунку ще немає — заповни форму: App title і Short name (будь-які, напр. «parser»), платформа Web/Other.' }),
      el('p', { text: '4. Скопіюй звідти App api_id і App api_hash — і встав сюди.' }),
      el('p', { class: 'muted', text: 'Ці ключі — як пароль до API. Не показуй їх стороннім: тут вони зберігаються лише в пам\'яті твого браузера.' }),
    ]),
    actions: [{ label: 'Зрозуміло', value: true, kind: 'primary' }],
  })
}

/* ---------------------------------------------------------- крок 2 --- */

function codeStep(ctx, data) {
  const code = textInput({
    inputmode: 'numeric', autocomplete: 'one-time-code',
    placeholder: '12345', maxlength: 6,
  })
  const btn = el('button', { class: 'btn btn--primary btn--block', type: 'submit', text: 'Увійти' })

  const form = el('form', { class: 'stack', onsubmit: onSubmit }, [
    el('div', { class: 'card' }, [
      el('p', { class: 'small', text: data.isCodeViaApp
        ? `Код надіслано в застосунок Telegram на ${data.phone}. Перевір чат «Telegram».`
        : `Код надіслано SMS на ${data.phone}.` }),
    ]),
    el('div', { class: 'section' }, [
      el('div', { class: 'section__body' }, [
        field({ label: 'Код підтвердження', input: code }),
      ]),
    ]),
    btn,
    el('button', {
      class: 'btn btn--ghost btn--block', type: 'button', text: 'Змінити номер',
      onclick: () => ctx.go('login', { step: 'creds' }),
    }),
  ])

  setTimeout(() => code.focus(), 100)

  async function onSubmit(e) {
    e.preventDefault()
    const value = code.value.trim()
    if (!/^\d{4,6}$/.test(value)) return toast('Код — це 5 цифр із Telegram', 'error')

    btn.disabled = true
    btn.textContent = 'Перевіряємо…'
    try {
      const res = await tg.signInWithCode({ phone: data.phone, phoneCodeHash: data.phoneCodeHash, code: value })
      if (res.status === 'password') {
        ctx.go('login', { step: 'password', data })
      } else {
        await ctx.onAuthorized()
      }
    } catch (err) {
      console.error(err)
      toast(tg.describeError(err), 'error', 6000)
      btn.disabled = false
      btn.textContent = 'Увійти'
    }
  }

  return form
}

/* ------------------------------------------------------ крок 2FA --- */

function passwordStep(ctx) {
  const pass = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: '••••••••' })
  const btn = el('button', { class: 'btn btn--primary btn--block', type: 'submit', text: 'Підтвердити' })

  const form = el('form', { class: 'stack', onsubmit: onSubmit }, [
    el('div', { class: 'card' }, [
      el('p', { class: 'small', text: 'На акаунті увімкнена двоетапна перевірка. Введи хмарний пароль Telegram.' }),
    ]),
    el('div', { class: 'section' }, [
      el('div', { class: 'section__body' }, [field({ label: 'Пароль', input: pass })]),
    ]),
    btn,
  ])

  setTimeout(() => pass.focus(), 100)

  async function onSubmit(e) {
    e.preventDefault()
    if (!pass.value) return toast('Введи пароль', 'error')
    btn.disabled = true
    btn.textContent = 'Перевіряємо…'
    try {
      await tg.signInWithPassword(pass.value)
      await ctx.onAuthorized()
    } catch (err) {
      console.error(err)
      toast(tg.describeError(err), 'error', 6000)
      btn.disabled = false
      btn.textContent = 'Підтвердити'
    }
  }

  return form
}
