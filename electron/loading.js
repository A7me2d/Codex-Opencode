const controls = window.codingRoomWindow
document.querySelector('[data-action="minimize"]')?.addEventListener('click', () => void controls?.minimize?.())
document.querySelector('[data-action="maximize"]')?.addEventListener('click', () => void controls?.toggleMaximize?.())
document.querySelector('[data-action="close"]')?.addEventListener('click', () => void controls?.close?.())
document.querySelector('header')?.addEventListener('dblclick', event => {
  if (!event.target.closest('button')) void controls?.toggleMaximize?.()
})
