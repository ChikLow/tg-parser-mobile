import './styles.css'
import { el, clear, toast } from './ui.js'
import { state, runtime } from './state.js'
import * as tg from './tg.js'
import { loginScreen } from './screens/login.js'
import { chatsScreen } from './screens/chats.js'
import { parseScreen, isRunning } from './screens/parse.js'
import { resultsScreen } from './screens/results.js'
import { settingsScreen } from './screens/settings.js'

const root = document.getElementById('app')

const SCREENS = {
  login: loginScreen,
  chats: chatsScreen,
  parse: parseScreen,
  results: resultsScreen,
  settings: settingsScreen,
}

const TABS = [
  { id: 'chats', icon: '💬', label: 'Чати' },
  { id: 'parse', icon: '🔎', label: 'Парсер' },
  { id: 'results', icon: '📋', label: 'Результати' },
  { id: 'settings', icon: '⚙️', label: 'Ще' },
]

const ctx = {
  screen: 'login',
  params: {},
  authorized: false,
  go(screen, params = {}) {
    ctx.screen = screen
    ctx.params = params
    ctx.render()
    window.scrollTo({ top: 0 })
  },
  render,
  async onAuthorized() {
    ctx.authorized = true
    toast(`Вітаємо, ${runtime.me?.name || ''}!`, 'ok')
    ctx.go('chats')
  },
}

function render() {
  const factory = SCREENS[ctx.screen] || chatsScreen
  let view
  try {
    view = factory(ctx)
  } catch (e) {
    console.error('Помилка екрана', e)
    view = {
      title: 'Помилка',
      body: el('div', { class: 'card' }, [
        el('p', { text: String(e?.message || e) }),
        el('button', { class: 'btn btn--block', text: 'На головну', onclick: () => ctx.go('chats') }),
      ]),
    }
  }

  clear(root)

  root.append(el('header', { class: 'app-bar' }, [
    el('div', { class: 'app-bar__title' }, [
      document.createTextNode(view.title || 'TG Parser'),
      view.subtitle ? el('span', { class: 'app-bar__sub', text: view.subtitle }) : null,
    ]),
    view.action || null,
  ]))

  root.append(el('main', { class: `screen ${view.plain ? 'screen--plain' : ''}` }, [view.body]))

  if (ctx.authorized && !view.plain) root.append(navBar())
}

function navBar() {
  return el('nav', { class: 'nav' }, TABS.map((t) => {
    const active = ctx.screen === t.id
    const badge = t.id === 'results'
      ? (runtime.results?.length || 0) + (runtime.members?.length || 0)
      : 0
    return el('button', {
      class: `nav__item ${active ? 'is-active' : ''}`, type: 'button',
      onclick: () => ctx.go(t.id),
    }, [
      el('span', { text: t.icon }),
      el('span', { text: t.label }),
      badge ? el('span', { class: 'nav__badge', text: badge > 999 ? '999+' : String(badge) }) : null,
    ])
  }))
}

/* -------------------------------------------------------------- старт --- */

async function boot() {
  root.innerHTML = `
    <div class="boot">
      <div class="boot__logo"></div>
      <div class="boot__text">Відновлюємо сесію…</div>
    </div>`

  try {
    const me = await tg.restore()
    if (me) {
      ctx.authorized = true
      ctx.go('chats')
      return
    }
  } catch (e) {
    console.warn('restore failed', e)
    const text = tg.describeError(e)
    setTimeout(() => toast(text, 'error', 5000), 400)
  }

  ctx.authorized = false
  ctx.go('login', { step: state.apiId && state.apiHash ? 'creds' : 'creds' })
}

// Попередження перед закриттям вкладки, якщо триває збір або є незбережені дані
window.addEventListener('beforeunload', (e) => {
  if (isRunning() || runtime.results?.length || runtime.members?.length) {
    e.preventDefault()
    e.returnValue = ''
  }
})

boot()

/* ------------------------------------------------------- service worker --- */

if ('serviceWorker' in navigator) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onNeedRefresh() {
          toast('Доступна нова версія — перезапусти застосунок', 'info', 6000)
        },
        onOfflineReady() {
          console.info('Готово до роботи офлайн')
        },
      })
    })
    .catch((e) => console.warn('SW register failed', e))
}
