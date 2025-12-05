import { ThemeConfig } from './types'

export function applyTheme(theme: ThemeConfig) {
  if (typeof document === 'undefined') return

  const root = document.documentElement

  if (theme.primaryColor) {
    root.style.setProperty('--color-primary', theme.primaryColor)
  }

  if (theme.secondaryColor) {
    root.style.setProperty('--color-secondary', theme.secondaryColor)
  }

  if (theme.fontFamily) {
    root.style.setProperty('--font-family', theme.fontFamily)
  }

  if (theme.logoUrl) {
    root.style.setProperty('--logo-url', `url(${theme.logoUrl})`)
  }
}

