// Мінімальні DOM-хелпери + спільні віджети (тости, модалки, шит вибору).

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class') node.className = v
    else if (k === 'html') node.innerHTML = v
    else if (k === 'text') node.textContent = v
    else if (k === 'dataset') Object.assign(node.dataset, v)
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v)
    else if (k in node && k !== 'list' && k !== 'type') node[k] = v
    else node.setAttribute(k, v === true ? '' : v)
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
  return node
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c])
}

/* ---------------------------------------------------------------- тости --- */

let toastHost
export function toast(message, kind = 'info', ms = 3200) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toasts' })
    document.body.append(toastHost)
  }
  const node = el('div', { class: `toast toast--${kind}`, text: message })
  toastHost.append(node)
  requestAnimationFrame(() => node.classList.add('is-in'))
  setTimeout(() => {
    node.classList.remove('is-in')
    setTimeout(() => node.remove(), 250)
  }, ms)
  return node
}

/* -------------------------------------------------------------- модалки --- */

export function modal({ title, body, actions = [], dismissable = true }) {
  const backdrop = el('div', { class: 'modal-backdrop' })
  const close = (value) => {
    backdrop.classList.remove('is-in')
    setTimeout(() => backdrop.remove(), 200)
    resolve(value)
  }
  let resolve
  const done = new Promise((r) => { resolve = r })

  const card = el('div', { class: 'modal' }, [
    title ? el('h3', { class: 'modal__title', text: title }) : null,
    el('div', { class: 'modal__body' }, [body]),
    el('div', { class: 'modal__actions' },
      actions.map((a) =>
        el('button', {
          class: `btn ${a.kind ? `btn--${a.kind}` : ''}`,
          type: 'button',
          text: a.label,
          onclick: () => close(a.value),
        })
      )
    ),
  ])
  backdrop.append(card)
  if (dismissable) {
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(undefined) })
  }
  document.body.append(backdrop)
  requestAnimationFrame(() => backdrop.classList.add('is-in'))
  return done
}

export function confirmDialog(title, text, okLabel = 'Так', kind = 'danger') {
  return modal({
    title,
    body: el('p', { class: 'muted', text }),
    actions: [
      { label: 'Скасувати', value: false },
      { label: okLabel, value: true, kind },
    ],
  }).then((v) => v === true)
}

/* ------------------------------------------------------------ компоненти --- */

export function field({ label, hint, input }) {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: label }),
    input,
    hint ? el('span', { class: 'field__hint', html: hint }) : null,
  ])
}

export function textInput(attrs = {}) {
  return el('input', { class: 'input', type: 'text', autocomplete: 'off', ...attrs })
}

export function switchRow({ label, hint, checked = false, onchange }) {
  const input = el('input', { type: 'checkbox', checked, onchange: (e) => onchange?.(e.target.checked) })
  return el('label', { class: 'switch-row' }, [
    el('span', {}, [
      el('span', { class: 'switch-row__label', text: label }),
      hint ? el('span', { class: 'switch-row__hint', text: hint }) : null,
    ]),
    el('span', { class: 'switch' }, [input, el('span', { class: 'switch__track' })]),
  ])
}

export function section(title, children, extra) {
  return el('section', { class: 'section' }, [
    title ? el('div', { class: 'section__head' }, [
      el('h2', { class: 'section__title', text: title }),
      extra || null,
    ]) : null,
    el('div', { class: 'section__body' }, [].concat(children)),
  ])
}

export function empty(icon, title, text) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty__icon', text: icon }),
    el('div', { class: 'empty__title', text: title }),
    text ? el('div', { class: 'empty__text', text }) : null,
  ])
}

export function spinner(text) {
  return el('div', { class: 'loading' }, [el('div', { class: 'spinner' }), text ? el('span', { text }) : null])
}

/* ---------------------------------------------------------------- утиліти --- */

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => [...p][0] || '').join('').toUpperCase() || '?'
}

const AVATAR_COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#faa774', '#6ec9cb']
export function avatarColor(key) {
  const s = String(key ?? '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function fmtNumber(n) {
  return new Intl.NumberFormat('uk-UA').format(n ?? 0)
}

export function fmtBytes(bytes) {
  if (!bytes) return '—'
  const units = ['Б', 'КБ', 'МБ', 'ГБ']
  let i = 0
  let v = Number(bytes)
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function fmtDate(iso, withTime = true) {
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`
}

export function debounce(fn, ms = 250) {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}
