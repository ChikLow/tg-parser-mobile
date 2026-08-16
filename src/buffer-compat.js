// Лагодимо перевірки `instanceof Buffer` у браузерній збірці.
//
// У бандл потрапляє кілька незалежних копій пакета `buffer`: одну підкладає
// vite-plugin-node-polyfills як глобальний Buffer, іншу тягне за собою
// crypto-browserify (через safe-buffer) — саме вона повертає результат
// crypto.createHash(...).digest().
//
// Обидві копії — повноцінні Buffer, але класи різні, тому `x instanceof Buffer`
// між ними дає false. GramJS перевіряє саме так перед серіалізацією TL-полів
// типу bytes і падає з «Bytes or str expected, not …» — наприклад на хеші M1
// під час входу з двоетапною перевіркою.
//
// Buffer.isBuffer() працює правильно для будь-якої копії (перевіряє позначку
// _isBuffer, а не клас), тож перенаправляємо instanceof на неї. Звичайний
// Uint8Array так само лишається «не Buffer».

let applied = false

export function applyBufferCompat() {
  if (applied || typeof Buffer === 'undefined') return
  applied = true
  try {
    Object.defineProperty(Buffer, Symbol.hasInstance, {
      value: (obj) => Buffer.isBuffer(obj),
      configurable: true,
    })
  } catch (e) {
    console.warn('Не вдалось узгодити реалізації Buffer', e)
  }
}
