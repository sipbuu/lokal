import { useState, useEffect } from 'react'
import { api } from './api'
import { THEMES, applyTheme } from './theme'

const PERSISTENT_THEME_OVERRIDE_KEYS = [
  '--bg-image',
  '--bg-overlay',
  '--bg-blur',
  '--bg-size',
  '--bg-position',
  '--logo-image-filter',
  '--logo-image-opacity',
  '--logo-mask-opacity',
  '--logo-wrap-bg',
  '--logo-wrap-shadow',
  '--logo-wrap-border',
]

export function useTheme() {
  const [themeName, setThemeName] = useState('dark')
  const [themeOverrides, setThemeOverrides] = useState({})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [textScale, setTextScaleState] = useState('1')

  useEffect(() => {
    if (api.isElectron) {
      api.getTheme().then(t => {
        if (t) {
          setThemeName(t.theme || 'dark')
          setThemeOverrides(t.overrides || {})
          const baseVars = THEMES[t.theme]?.vars || THEMES.dark.vars
          applyTheme({ ...baseVars, ...(t.overrides || {}) })
          
          const textScaleValue = t.overrides?.['--text-scale'] || '1'
          setTextScaleState(textScaleValue)
          document.documentElement.style.setProperty('--text-scale', textScaleValue)
        }
      })
    }
  }, []);

  const selectTheme = async (name) => {
    const preservedOverrides = Object.fromEntries(
      Object.entries(themeOverrides).filter(([key]) => PERSISTENT_THEME_OVERRIDE_KEYS.includes(key))
    )
    setThemeName(name)
    setThemeOverrides(preservedOverrides)
    const vars = { ...(THEMES[name]?.vars || THEMES.dark.vars), ...preservedOverrides }
    applyTheme(vars)
    await api.saveTheme(name, preservedOverrides)
  }

  const setAccent = async (accentColor) => {
    const accent = { '--accent': accentColor.value, '--accent-dim': accentColor.dim }
    const newOverrides = { ...themeOverrides, ...accent }
    setThemeOverrides(newOverrides)
    const vars = { ...THEMES[themeName]?.vars, ...newOverrides }
    applyTheme(vars)
    await api.saveTheme(themeName, newOverrides)
  }

  const saveOverride = async (key, value) => {
    const overrides = { ...themeOverrides, [key]: value }
    setThemeOverrides(overrides)
    const vars = { ...THEMES[themeName]?.vars, ...overrides }
    applyTheme(vars)
    await api.saveTheme(themeName, overrides)
  }

  const saveOverrides = async (patch) => {
    const overrides = { ...themeOverrides, ...patch }
    setThemeOverrides(overrides)
    const vars = { ...THEMES[themeName]?.vars, ...overrides }
    applyTheme(vars)
    await api.saveTheme(themeName, overrides)
  }

  const resetTheme = async () => {
    setThemeOverrides({})
    const vars = THEMES[themeName]?.vars || THEMES.dark.vars
    applyTheme(vars)
    await api.saveTheme(themeName, {})
  }

  const setTextScale = async (scale) => {
    setTextScaleState(scale)
    const overrides = { ...themeOverrides, '--text-scale': scale }
    setThemeOverrides(overrides)
    const vars = { ...THEMES[themeName]?.vars, ...overrides }
    applyTheme(vars)
    await api.saveTheme(themeName, overrides)
  }

  return {
    themeName, setThemeName,
    themeOverrides,
    showAdvanced, setShowAdvanced,
    selectTheme, setAccent, saveOverride, saveOverrides, resetTheme,
    textScale, setTextScale
  }
}
