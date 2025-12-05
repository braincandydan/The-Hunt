export interface ThemeConfig {
  primaryColor: string
  secondaryColor?: string
  fontFamily?: string
  logoUrl?: string
  faviconUrl?: string
}

export interface ResortTheme {
  id: string
  name: string
  slug: string
  themeConfig: ThemeConfig
}

