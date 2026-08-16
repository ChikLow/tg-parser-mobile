// Стан застосунку. Усе живе тільки в браузері телефона — нічого не йде на сервер.

const KEY = 'tgparser.v1'

const DEFAULTS = {
  apiId: '',
  apiHash: '',
  session: '',
  lastPhone: '',
  rememberSession: true,
  // останні використані параметри парсингу
  lastParse: {
    limit: 500,
    search: '',
    keywords: '',
    keywordMode: 'any', // any | all | regex
    mediaOnly: false,
    textOnly: false,
    mediaKind: '', // '' | photos | video | documents | audio | voice | links | gifs
    minViews: '',
    fromUser: '',
    dateFrom: '',
    dateTo: '',
    skipService: true,
    waitTime: 1,
  },
  dialogs: [],
  dialogsAt: 0,
}

function read() {
  try {
    // sessionStorage має пріоритет: там лежить сесія, коли «Пам'ятати вхід» вимкнено
    const raw = sessionStorage.getItem(KEY) || localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...parsed, lastParse: { ...DEFAULTS.lastParse, ...(parsed.lastParse || {}) } }
  } catch {
    return { ...DEFAULTS }
  }
}

export const state = read()

// Не персистимо важкі/тимчасові поля
const TRANSIENT = new Set(['results', 'members', 'peer', 'me'])

export function save() {
  const plain = {}
  for (const [k, v] of Object.entries(state)) {
    if (!TRANSIENT.has(k)) plain[k] = v
  }
  const json = JSON.stringify(plain)
  try {
    if (state.rememberSession) {
      localStorage.setItem(KEY, json)
      sessionStorage.removeItem(KEY)
    } else {
      // сесія живе лише до закриття вкладки
      sessionStorage.setItem(KEY, json)
      const onlySettings = { ...plain, session: '' }
      localStorage.setItem(KEY, JSON.stringify(onlySettings))
    }
  } catch (e) {
    console.warn('Не вдалось зберегти стан', e)
  }
}

export function patch(partial) {
  Object.assign(state, partial)
  save()
  return state
}

export function wipe({ keepCredentials = false } = {}) {
  const apiId = keepCredentials ? state.apiId : ''
  const apiHash = keepCredentials ? state.apiHash : ''
  for (const k of Object.keys(state)) delete state[k]
  Object.assign(state, { ...DEFAULTS, apiId, apiHash })
  try {
    localStorage.removeItem(KEY)
    sessionStorage.removeItem(KEY)
  } catch { /* ignore */ }
  save()
}

/* --- Дані поточної сесії (в пам'яті, не зберігаються) --- */
export const runtime = {
  me: null,
  peer: null,        // обраний чат {id, title, username, type, raw}
  results: [],       // останній результат парсингу повідомлень
  resultsMeta: null, // {peer, startedAt, finishedAt, scanned, params}
  members: [],       // останній результат парсингу учасників
  membersMeta: null,
}
