// Перехоплення події встановлення PWA (Android/Chrome) + визначення режиму «з домашнього екрана».

let deferredPrompt = null
const listeners = new Set()

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt = e
  for (const fn of listeners) fn(true)
})

window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  for (const fn of listeners) fn(false)
})

export function getInstallPrompt() {
  return deferredPrompt
}

export function onInstallAvailable(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
}
