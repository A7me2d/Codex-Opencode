import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { initializeTheme } from './lib/themes'
import { getLocale, setLocale } from './lib/i18n'
import { hydratePreferences } from './lib/preferences'

void hydratePreferences().finally(() => {
  try { setLocale(window.localStorage.getItem('coding-room.locale') === 'ar' ? 'ar' : 'en') } catch { setLocale(getLocale()) }
  initializeTheme()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
