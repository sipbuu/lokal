import { useState, useEffect } from 'react'
import { api } from '../api'
import { THEMES, applyTheme } from '../theme'

export function useTheme() {
  const [themeName, setThemeName] = useState('dark')
  const [themeOverrides, setThemeOverrides] = useState({})
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    if (api.isElectron) {
      api.getTheme().then(t => {
        if (t) {
          setThemeName(t.theme || 'dark')
          setThemeOverrides(t.overrides || {})
          const baseVars = THEMES[t.theme]?.vars || THEMES.dark.vars
          applyTheme({ ...baseVars, ...(t.overrides || {}) })
        }
      })
    }
  }, [])

  const selectTheme = async (name) => {
    setThemeName(name)
    setThemeOverrides({})
    const vars = THEMES[name]?.vars || THEMES.dark.vars
    applyTheme(vars)
    await api.saveTheme(name, {})
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

  const resetTheme = async () => {
    setThemeOverrides({})
    const vars = THEMES[themeName]?.vars || THEMES.dark.vars
    applyTheme(vars)
    await api.saveTheme(themeName, {})
  }

  return {
    themeName, setThemeName,
    themeOverrides,
    showAdvanced, setShowAdvanced,
    selectTheme, setAccent, saveOverride, resetTheme
  }
}
