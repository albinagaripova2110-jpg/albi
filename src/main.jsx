import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Polyfill window.storage for non-Claude environments (uses localStorage)
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
