import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { applyTheme, THEMES } from './theme'

async function initTheme() {
  try {
    const settings = await window.electron?.getSettings() || {}
    const saved = settings.theme || 'dark'
    const customOverrides = settings.theme_overrides ? JSON.parse(settings.theme_overrides) : {}
    const baseVars = THEMES[saved]?.vars || THEMES.dark.vars
    applyTheme({ ...baseVars, ...customOverrides })
  } catch (e) {
    console.error('Failed to load theme:', e)
    applyTheme(THEMES.dark.vars)
  }
}

initTheme()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}))
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
