// Обгортка над MTProto-клієнтом (GramJS). Працює прямо в браузері:
// телефон під'єднується до серверів Telegram по WebSocket, без жодного бекенду.

// Має бути найпершим імпортом: узгоджує реалізації Buffer до того, як GramJS
// почне серіалізувати TL-запити.
import { applyBufferCompat } from './buffer-compat.js'
import { TelegramClient, Api, errors, utils, password as srp } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { state, patch, runtime } from './state.js'

applyBufferCompat()

let client = null

export function getClient() {
  return client
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------- помилки --- */

const ERROR_TEXT = {
  API_ID_INVALID: 'Невірний api_id або api_hash. Перевір їх на my.telegram.org.',
  API_ID_PUBLISHED_FLOOD: 'Ці api_id заблоковані Telegram. Створи власні на my.telegram.org.',
  PHONE_NUMBER_INVALID: 'Невірний номер телефону. Формат: +380XXXXXXXXX',
  PHONE_NUMBER_BANNED: 'Цей номер заблокований у Telegram.',
  PHONE_NUMBER_UNOCCUPIED: 'На цьому номері немає акаунта Telegram.',
  PHONE_CODE_INVALID: 'Невірний код. Спробуй ще раз.',
  PHONE_CODE_EXPIRED: 'Код протермінувався — запроси новий.',
  PHONE_CODE_EMPTY: 'Введи код із Telegram.',
  PASSWORD_HASH_INVALID: 'Невірний пароль двоетапної перевірки.',
  SESSION_PASSWORD_NEEDED: 'Потрібен пароль двоетапної перевірки.',
  AUTH_KEY_UNREGISTERED: 'Сесія недійсна — треба увійти заново.',
  AUTH_KEY_DUPLICATED: 'Сесію використано в іншому місці. Увійди заново.',
  SESSION_REVOKED: 'Сесію відкликано в налаштуваннях Telegram. Увійди заново.',
  USER_DEACTIVATED_BAN: 'Акаунт заблокований Telegram.',
  CHANNEL_PRIVATE: 'Немає доступу: це приватний канал/група, і твій акаунт туди не входить.',
  CHAT_ADMIN_REQUIRED: 'Для цієї дії потрібні права адміністратора в чаті.',
  USERNAME_NOT_OCCUPIED: 'Такого username не існує.',
  USERNAME_INVALID: 'Некоректний username.',
  PEER_ID_INVALID: 'Не вдалось знайти цей чат. Відкрий його у списку «Чати».',
  MSG_ID_INVALID: 'Некоректний ID повідомлення.',
  TIMEOUT: 'Час очікування вичерпано. Перевір інтернет і спробуй ще раз.',
}

export function describeError(e) {
  if (!e) return 'Невідома помилка'
  const raw = e.errorMessage || e.message || String(e)
  if (isFlood(e)) return `Telegram просить зачекати ${floodSeconds(e)} с.`
  for (const [code, text] of Object.entries(ERROR_TEXT)) {
    if (raw.includes(code)) return text
  }
  if (/websocket|network|failed to fetch|disconnect/i.test(raw)) {
    return 'Немає зв\'язку з Telegram. Перевір інтернет (у деяких мережах Telegram блокують).'
  }
  return raw
}

export function isFlood(e) {
  return Boolean(
    e && (e instanceof errors.FloodWaitError || e.className === 'FloodWaitError' ||
      /FLOOD_WAIT|FLOOD_PREMIUM_WAIT|SLOWMODE_WAIT/.test(e.errorMessage || e.message || ''))
  )
}

export function floodSeconds(e) {
  if (e?.seconds != null) return Number(e.seconds)
  const m = String(e?.errorMessage || e?.message || '').match(/(\d+)/)
  return m ? Number(m[1]) : 30
}

function isNetworkError(e) {
  const raw = String(e?.errorMessage || e?.message || e)
  return /websocket|network|timeout|disconnect|not connected|closed/i.test(raw)
}

export class Cancelled extends Error {
  constructor() { super('Скасовано') }
}

/* ------------------------------------------------------- підключення --- */

export function createClient({ apiId, apiHash, session }) {
  const stringSession = new StringSession(session || '')
  client = new TelegramClient(stringSession, Number(apiId), String(apiHash).trim(), {
    connectionRetries: 5,
    retryDelay: 1500,
    timeout: 20,
    useWSS: true,            // у браузері доступний тільки WebSocket-транспорт
    autoReconnect: true,
    floodSleepThreshold: 5,  // дрібні паузи ковтаємо самі, довгі — показуємо користувачу
    deviceModel: deviceModel(),
    systemVersion: navigator.platform || 'Web',
    appVersion: '1.0.0',
    langCode: 'uk',
    systemLangCode: 'uk',
    baseLogger: undefined,
  })
  client.setLogLevel('error')
  return client
}

function deviceModel() {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone (Web)'
  if (/Android/.test(ua)) return 'Android (Web)'
  return 'Browser'
}

export async function connect() {
  if (!client) throw new Error('Клієнт не створено')
  if (!client.connected) await client.connect()
  return client
}

export function saveSession() {
  try {
    const s = client?.session?.save?.()
    if (typeof s === 'string' && s) patch({ session: s })
  } catch (e) {
    console.warn('session save failed', e)
  }
}

/** Спроба відновити збережену сесію. Повертає користувача або null. */
export async function restore() {
  if (!state.session || !state.apiId || !state.apiHash) return null
  createClient({ apiId: state.apiId, apiHash: state.apiHash, session: state.session })
  await connect()
  const authorized = await client.checkAuthorization()
  if (!authorized) return null
  const me = await client.getMe()
  runtime.me = normalizeUser(me)
  return runtime.me
}

/* ---------------------------------------------------------------- вхід --- */

export async function sendLoginCode(phone) {
  const { phoneCodeHash, isCodeViaApp } = await client.sendCode(
    { apiId: Number(state.apiId), apiHash: String(state.apiHash).trim() },
    phone.trim()
  )
  return { phoneCodeHash, isCodeViaApp }
}

/**
 * Вхід за кодом. Повертає {status:'ok'|'password'}.
 */
export async function signInWithCode({ phone, phoneCodeHash, code }) {
  try {
    await client.invoke(new Api.auth.SignIn({
      phoneNumber: phone.trim(),
      phoneCodeHash,
      phoneCode: String(code).trim(),
    }))
  } catch (e) {
    if (String(e.errorMessage || e.message).includes('SESSION_PASSWORD_NEEDED')) {
      return { status: 'password' }
    }
    throw e
  }
  await afterLogin()
  return { status: 'ok' }
}

/**
 * Вхід із хмарним паролем (SRP).
 *
 * Робимо це вручну, а не через client.signInWithPassword: обчислені A та M1
 * приходять із crypto-browserify, тобто з «чужої» копії Buffer, і TL-серіалізація
 * їх відхиляє. Buffer.from() приводить їх до тієї реалізації, яку очікує GramJS.
 */
export async function signInWithPassword(password) {
  const info = await client.invoke(new Api.account.GetPassword())
  const check = await srp.computeCheck(info, password)
  await client.invoke(new Api.auth.CheckPassword({
    password: new Api.InputCheckPasswordSRP({
      srpId: check.srpId,
      A: Buffer.from(check.A),
      M1: Buffer.from(check.M1),
    }),
  }))
  await afterLogin()
  return { status: 'ok' }
}

async function afterLogin() {
  saveSession()
  const me = await client.getMe()
  runtime.me = normalizeUser(me)
  return runtime.me
}

export async function logout({ revoke = true } = {}) {
  try {
    if (client && revoke) await client.invoke(new Api.auth.LogOut())
  } catch (e) {
    console.warn('logout', e)
  }
  try { await client?.disconnect() } catch { /* ignore */ }
  try { await client?.destroy() } catch { /* ignore */ }
  client = null
  runtime.me = null
  runtime.peer = null
  runtime.results = []
  runtime.members = []
  patch({ session: '' })
}

/* -------------------------------------------------------------- чати --- */

export function normalizeUser(u) {
  if (!u) return null
  return {
    id: String(u.id ?? ''),
    username: u.username || '',
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    name: safeDisplayName(u),
    phone: u.phone || '',
    isBot: Boolean(u.bot),
    isPremium: Boolean(u.premium),
    isVerified: Boolean(u.verified),
  }
}

function safeDisplayName(entity) {
  try {
    const n = utils.getDisplayName(entity)
    if (n) return n
  } catch { /* ignore */ }
  return entity?.title || [entity?.firstName, entity?.lastName].filter(Boolean).join(' ') || ''
}

function dialogType(d) {
  try {
    if (d.isChannel && !d.entity?.megagroup) return 'channel'
    if (d.isChannel && d.entity?.megagroup) return 'supergroup'
    if (d.isGroup) return 'group'
    if (d.entity?.bot) return 'bot'
    if (d.isUser) return 'user'
  } catch { /* ignore */ }
  return 'chat'
}

export async function loadDialogs({ limit = 400, archived = false } = {}) {
  await connect()
  const dialogs = await client.getDialogs({ limit, archived })
  const out = []
  for (const d of dialogs) {
    try {
      const e = d.entity
      if (!e) continue
      out.push({
        id: utils.getPeerId(e),
        title: d.title || safeDisplayName(e) || 'Без назви',
        username: e.username || (e.usernames?.[0]?.username ?? ''),
        type: dialogType(d),
        members: Number(e.participantsCount || 0) || null,
        verified: Boolean(e.verified),
        archived: Boolean(archived),
      })
    } catch (err) {
      console.warn('dialog skip', err)
    }
  }
  patch({ dialogs: out, dialogsAt: Date.now() })
  return out
}

/** Витягує username/посилання/ID з довільного рядка. */
export function parsePeerInput(input) {
  const s = String(input || '').trim()
  if (!s) return null
  const link = s.match(/^(?:https?:\/\/)?(?:t(?:elegram)?\.me|telegram\.dog)\/(.+)$/i)
  if (link) {
    const rest = link[1].replace(/^s\//, '')
    if (/^(joinchat\/|\+)/i.test(rest)) return { kind: 'invite', value: rest.replace(/^joinchat\//i, '').replace(/^\+/, '') }
    if (/^c\/(\d+)/.test(rest)) return { kind: 'id', value: `-100${rest.match(/^c\/(\d+)/)[1]}` }
    return { kind: 'username', value: rest.split(/[/?#]/)[0] }
  }
  if (/^@?[a-z0-9_]{4,32}$/i.test(s)) return { kind: 'username', value: s.replace(/^@/, '') }
  if (/^-?\d{5,}$/.test(s)) return { kind: 'id', value: s }
  return { kind: 'username', value: s.replace(/^@/, '') }
}

/**
 * Перетворює збережений опис чату на сутність, яку розуміє GramJS.
 * Якщо ID немає в кеші (після перезавантаження сторінки) — підвантажує діалоги.
 */
export async function resolveEntity(peer) {
  await connect()
  const candidates = []
  if (peer?.username) candidates.push(peer.username)
  if (peer?.id) candidates.push(peer.id)

  let lastErr = null
  for (const c of candidates) {
    try {
      return await client.getEntity(c)
    } catch (e) {
      lastErr = e
      if (isFlood(e)) throw e
    }
  }
  // ID може бути відсутнім у кеші сутностей — оновлюємо діалоги й пробуємо ще раз
  try {
    await client.getDialogs({ limit: 500 })
    for (const c of candidates) {
      try { return await client.getEntity(c) } catch (e) { lastErr = e }
    }
  } catch (e) {
    lastErr = e
  }
  throw lastErr || new Error('Не вдалось знайти чат')
}

export async function peerFromInput(input) {
  const parsed = parsePeerInput(input)
  if (!parsed) throw new Error('Порожнє посилання')
  if (parsed.kind === 'invite') {
    throw new Error('Приватні запрошення (t.me/+…) не підтримуються: спочатку приєднайся до чату в Telegram, потім обери його у списку «Чати».')
  }
  await connect()
  const entity = await client.getEntity(parsed.kind === 'username' ? parsed.value : parsed.value)
  return {
    id: utils.getPeerId(entity),
    title: safeDisplayName(entity) || parsed.value,
    username: entity.username || '',
    type: entity.className === 'Channel'
      ? (entity.megagroup ? 'supergroup' : 'channel')
      : entity.className === 'Chat' ? 'group' : entity.bot ? 'bot' : 'user',
    members: Number(entity.participantsCount || 0) || null,
  }
}

/* ------------------------------------------------- нормалізація даних --- */

const MEDIA_FILTERS = {
  photos: () => new Api.InputMessagesFilterPhotos(),
  video: () => new Api.InputMessagesFilterVideo(),
  documents: () => new Api.InputMessagesFilterDocument(),
  audio: () => new Api.InputMessagesFilterMusic(),
  voice: () => new Api.InputMessagesFilterVoice(),
  gifs: () => new Api.InputMessagesFilterGif(),
  links: () => new Api.InputMessagesFilterUrl(),
  round: () => new Api.InputMessagesFilterRoundVideo(),
}

export const MEDIA_KINDS = [
  { value: '', label: 'Будь-які' },
  { value: 'photos', label: 'Фото' },
  { value: 'video', label: 'Відео' },
  { value: 'documents', label: 'Документи' },
  { value: 'audio', label: 'Музика' },
  { value: 'voice', label: 'Голосові' },
  { value: 'gifs', label: 'GIF' },
  { value: 'links', label: 'З посиланнями' },
  { value: 'round', label: 'Кружечки' },
]

function detectMedia(msg) {
  try {
    if (msg.photo) return 'photo'
    if (msg.sticker) return 'sticker'
    if (msg.gif) return 'gif'
    if (msg.videoNote) return 'round'
    if (msg.video) return 'video'
    if (msg.voice) return 'voice'
    if (msg.audio) return 'audio'
    if (msg.document) return 'document'
    if (msg.contact) return 'contact'
    if (msg.poll) return 'poll'
    if (msg.geo) return 'geo'
    if (msg.webPreview) return 'link'
  } catch { /* деякі геттери падають на екзотичних медіа */ }
  return ''
}

function extractEntities(msg) {
  const text = msg.message || ''
  const urls = []
  const hashtags = []
  const mentions = []
  for (const ent of msg.entities || []) {
    try {
      const slice = [...text].slice(ent.offset, ent.offset + ent.length).join('')
      switch (ent.className) {
        case 'MessageEntityUrl': urls.push(slice); break
        case 'MessageEntityTextUrl': if (ent.url) urls.push(ent.url); break
        case 'MessageEntityHashtag': hashtags.push(slice); break
        case 'MessageEntityMention': mentions.push(slice); break
        case 'MessageEntityMentionName': mentions.push(`id:${ent.userId}`); break
        default: break
      }
    } catch { /* ignore */ }
  }
  return { urls, hashtags, mentions }
}

function messageLink(peer, id) {
  if (peer?.username) return `https://t.me/${peer.username}/${id}`
  const raw = String(peer?.id || '').replace(/^-100/, '')
  if (/^\d+$/.test(raw) && String(peer?.id || '').startsWith('-100')) {
    return `https://t.me/c/${raw}/${id}`
  }
  return ''
}

export function normalizeMessage(msg, peer) {
  const { urls, hashtags, mentions } = extractEntities(msg)
  let file = null
  try { file = msg.file } catch { file = null }

  let senderName = ''
  let senderUsername = ''
  try {
    const s = msg.sender
    if (s) {
      senderName = safeDisplayName(s)
      senderUsername = s.username || ''
    }
  } catch { /* ignore */ }
  if (!senderName && msg.postAuthor) senderName = msg.postAuthor

  let fwdFrom = ''
  try {
    if (msg.fwdFrom) {
      fwdFrom = msg.fwdFrom.fromName || (msg.fwdFrom.fromId ? utils.getPeerId(msg.fwdFrom.fromId) : '')
    }
  } catch { /* ignore */ }

  return {
    id: msg.id,
    date: new Date((msg.date || 0) * 1000).toISOString(),
    text: msg.message || '',
    senderId: msg.senderId ? String(msg.senderId) : '',
    senderName,
    senderUsername,
    views: msg.views ?? null,
    forwards: msg.forwards ?? null,
    replies: msg.replies?.replies ?? null,
    replyToId: msg.replyTo?.replyToMsgId ?? null,
    isService: Boolean(msg.action),
    serviceAction: msg.action?.className || '',
    media: detectMedia(msg),
    fileName: file?.name || '',
    fileSize: file?.size != null ? Number(file.size) : null,
    mimeType: file?.mimeType || '',
    edited: msg.editDate ? new Date(msg.editDate * 1000).toISOString() : '',
    pinned: Boolean(msg.pinned),
    fwdFrom,
    urls,
    hashtags,
    mentions,
    reactions: countReactions(msg),
    link: messageLink(peer, msg.id),
  }
}

function countReactions(msg) {
  try {
    const results = msg.reactions?.results || []
    return results.reduce((sum, r) => sum + (r.count || 0), 0) || null
  } catch {
    return null
  }
}

/* ------------------------------------------------------- фільтрування --- */

export function buildMatcher(params) {
  const kw = String(params.keywords || '').trim()
  const minViews = params.minViews ? Number(params.minViews) : 0
  let regex = null
  let words = []

  if (kw) {
    if (params.keywordMode === 'regex') {
      regex = new RegExp(kw, 'i') // кине помилку на некоректному виразі — це навмисно
    } else {
      words = kw.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean)
    }
  }

  return (m) => {
    if (params.skipService && m.isService) return false
    if (params.mediaOnly && !m.media) return false
    if (params.textOnly && !m.text) return false
    if (minViews && (m.views ?? 0) < minViews) return false
    if (regex) return regex.test(m.text)
    if (words.length) {
      const hay = m.text.toLowerCase()
      return params.keywordMode === 'all'
        ? words.every((w) => hay.includes(w))
        : words.some((w) => hay.includes(w))
    }
    return true
  }
}

/* ----------------------------------------------------------- парсинг --- */

async function withRetry(fn, ctx) {
  for (let attempt = 0; ; attempt++) {
    if (ctx.token?.cancelled) throw new Cancelled()
    try {
      return await fn()
    } catch (e) {
      if (ctx.token?.cancelled) throw new Cancelled()
      if (isFlood(e)) {
        const secs = floodSeconds(e)
        await ctx.onFlood?.(secs)
        for (let left = secs; left > 0; left--) {
          if (ctx.token?.cancelled) throw new Cancelled()
          ctx.onFloodTick?.(left)
          await sleep(1000)
        }
        ctx.onFloodTick?.(0)
        continue
      }
      if (attempt < 3 && isNetworkError(e)) {
        ctx.onRetry?.(attempt + 1)
        await connect().catch(() => {})
        await sleep(1200 * (attempt + 1))
        continue
      }
      throw e
    }
  }
}

const BATCH = 100

/**
 * Парсинг повідомлень чату.
 * @param peer  збережений опис чату {id, username, title, type}
 * @param params параметри форми
 * @param ctx   {token:{cancelled}, onProgress, onFlood, onFloodTick, onRetry}
 */
export async function parseMessages(peer, params, ctx = {}) {
  const entity = await resolveEntity(peer)
  const matcher = buildMatcher(params)
  const scanLimit = Number(params.limit) || 0 // 0 = без обмежень
  const search = String(params.search || '').trim()
  const filter = params.mediaKind && MEDIA_FILTERS[params.mediaKind]
    ? MEDIA_FILTERS[params.mediaKind]()
    : undefined

  let fromUser
  if (params.fromUser) {
    try {
      fromUser = await client.getEntity(parsePeerInput(params.fromUser).value)
    } catch (e) {
      throw new Error(`Не вдалось знайти автора «${params.fromUser}»: ${describeError(e)}`)
    }
  }

  const dateFromTs = params.dateFrom ? Math.floor(new Date(`${params.dateFrom}T00:00:00`).getTime() / 1000) : null
  const dateToTs = params.dateTo ? Math.floor(new Date(`${params.dateTo}T23:59:59`).getTime() / 1000) : null

  const out = []
  let scanned = 0
  let offsetId = 0
  let total = null
  let reachedStart = false
  const startedAt = Date.now()
  const waitTime = Math.max(0, Number(params.waitTime ?? 1))

  while (!reachedStart) {
    if (ctx.token?.cancelled) break
    const want = scanLimit ? Math.min(BATCH, scanLimit - scanned) : BATCH
    if (want <= 0) break

    const query = {
      limit: want,
      ...(offsetId ? { offsetId } : dateToTs ? { offsetDate: dateToTs } : {}),
      ...(search ? { search } : {}),
      ...(filter ? { filter } : {}),
      ...(fromUser ? { fromUser } : {}),
    }

    const batch = await withRetry(() => client.getMessages(entity, query), ctx)
    if (total == null && batch?.total != null) total = Number(batch.total)
    if (!batch || batch.length === 0) break

    for (const msg of batch) {
      scanned++
      if (dateFromTs && msg.date < dateFromTs) { reachedStart = true; break }
      if (dateToTs && msg.date > dateToTs) continue
      let norm
      try {
        norm = normalizeMessage(msg, peer)
      } catch (e) {
        console.warn('normalize failed', e)
        continue
      }
      if (matcher(norm)) out.push(norm)
    }

    offsetId = batch[batch.length - 1].id
    ctx.onProgress?.({
      scanned,
      matched: out.length,
      total,
      lastDate: batch[batch.length - 1].date ? new Date(batch[batch.length - 1].date * 1000) : null,
      elapsed: Date.now() - startedAt,
    })

    if (batch.length < want) break
    if (waitTime) await sleep(waitTime * 1000)
  }

  return {
    items: out,
    scanned,
    total,
    cancelled: Boolean(ctx.token?.cancelled),
    startedAt,
    finishedAt: Date.now(),
  }
}

/* ---------------------------------------------------------- учасники --- */

const DEEP_QUERIES = [
  '', 'а', 'б', 'в', 'г', 'д', 'е', 'ж', 'з', 'и', 'і', 'к', 'л', 'м', 'н', 'о',
  'п', 'р', 'с', 'т', 'у', 'ф', 'х', 'ц', 'ч', 'ш', 'щ', 'ю', 'я',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '_',
]

function statusText(status) {
  switch (status?.className) {
    case 'UserStatusOnline': return 'онлайн'
    case 'UserStatusOffline':
      return status.wasOnline ? `був(ла) ${new Date(status.wasOnline * 1000).toLocaleString('uk-UA')}` : 'офлайн'
    case 'UserStatusRecently': return 'нещодавно'
    case 'UserStatusLastWeek': return 'цього тижня'
    case 'UserStatusLastMonth': return 'цього місяця'
    default: return ''
  }
}

function normalizeMember(u) {
  return {
    id: String(u.id ?? ''),
    username: u.username || (u.usernames?.[0]?.username ?? ''),
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    name: safeDisplayName(u),
    phone: u.phone || '',
    isBot: Boolean(u.bot),
    isPremium: Boolean(u.premium),
    isDeleted: Boolean(u.deleted),
    status: statusText(u.status),
    link: u.username ? `https://t.me/${u.username}` : '',
  }
}

export async function parseMembers(peer, params, ctx = {}) {
  const entity = await resolveEntity(peer)
  const limit = Number(params.limit) || 0
  const seen = new Map()      // тільки ті, що пройшли фільтри — саме їх повертаємо
  const everSeen = new Set()  // усі побачені ID: захист від нескінченного циклу
  const startedAt = Date.now()
  const queries = params.deep ? DEEP_QUERIES : ['']
  const waitTime = Math.max(0, Number(params.waitTime ?? 1))
  let total = null

  outer:
  for (const q of queries) {
    let offset = 0
    for (;;) {
      if (ctx.token?.cancelled) break outer
      const want = limit ? Math.min(200, limit - seen.size) : 200
      if (want <= 0) break outer

      const chunk = await withRetry(
        () => client.getParticipants(entity, { limit: want, offset, search: q || undefined }),
        ctx
      )
      if (total == null && chunk?.total != null) total = Number(chunk.total)
      if (!chunk || chunk.length === 0) break

      // У звичайних групах Telegram віддає весь список одразу й ігнорує offset —
      // без цієї перевірки ми б крутились по тих самих людях вічно.
      let fresh = 0
      for (const u of chunk) {
        const id = String(u.id)
        if (!everSeen.has(id)) {
          everSeen.add(id)
          fresh++
        }
        if (!seen.has(id)) {
          if (params.skipBots && u.bot) continue
          if (params.skipDeleted && u.deleted) continue
          seen.set(id, normalizeMember(u))
        }
      }
      if (fresh === 0) break
      offset += chunk.length
      ctx.onProgress?.({
        scanned: offset,
        matched: seen.size,
        total,
        query: q,
        elapsed: Date.now() - startedAt,
      })
      if (chunk.length < want) break
      if (waitTime) await sleep(waitTime * 1000)
    }
  }

  return {
    items: [...seen.values()],
    total,
    cancelled: Boolean(ctx.token?.cancelled),
    startedAt,
    finishedAt: Date.now(),
  }
}

/* -------------------------------------------------- завантаження медіа --- */

export async function downloadMessageMedia(peer, messageId, onProgress) {
  const entity = await resolveEntity(peer)
  const found = await client.getMessages(entity, { ids: [messageId] })
  const msg = found?.[0]
  if (!msg) throw new Error('Повідомлення не знайдено')
  const buffer = await client.downloadMedia(msg, {
    progressCallback: (received, total) => {
      try { onProgress?.(Number(received), Number(total)) } catch { /* ignore */ }
    },
  })
  if (!buffer) throw new Error('У цьому повідомленні немає медіа')
  let file = null
  try { file = msg.file } catch { /* ignore */ }
  const ext = file?.mimeType?.split('/')?.[1]?.split(';')?.[0] || 'bin'
  return {
    blob: new Blob([buffer], { type: file?.mimeType || 'application/octet-stream' }),
    name: file?.name || `${peer.username || 'tg'}_${messageId}.${ext}`,
  }
}
