import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Telegram WebApp init
const tg = window.Telegram?.WebApp
if (tg) {
  tg.ready()
  tg.expand() // Открыть на весь экран
  tg.setHeaderColor('#f9f8f6')
  tg.setBackgroundColor('#f9f8f6')
}

// Expose Telegram user name globally so App can use it
window.tgUser = tg?.initDataUnsafe?.user || null

// Polyfill window.storage (localStorage) for non-Claude environments
if (!window.storage) {
  window.storage = {
    get: async (key) => {
      const val = localStorage.getItem(key)
      return val ? { key, value: val } : null
    },
    set: async (key, value) => {
      localStorage.setItem(key, value)
      return { key, value }
    },
    delete: async (key) => {
      localStorage.removeItem(key)
      return { key, deleted: true }
    },
    list: async (prefix = '') => {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix))
      return { keys }
    }
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
