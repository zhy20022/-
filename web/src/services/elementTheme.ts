import type { CSSProperties } from 'react'

export interface ElementTheme {
  key: string
  name: string
  symbol: string
  primary: string
  secondary: string
  highlight: string
  background: string
  dark: string
  text: string
  onPrimary: string
}

export const ELEMENT_THEMES: Record<string, ElementTheme> = {
  FIRE: { key: 'FIRE', name: '\u706b', symbol: '\u25b2', primary: '#c62828', secondary: '#8e1b1b', highlight: '#ffb454', background: '#fff1f0', dark: '#3b1313', text: '#861b1b', onPrimary: '#ffffff' },
  WATER: { key: 'WATER', name: '\u6c34', symbol: '\u25cf', primary: '#1565c0', secondary: '#0d4182', highlight: '#70dbff', background: '#eef6ff', dark: '#10273e', text: '#124b8e', onPrimary: '#ffffff' },
  EARTH: { key: 'EARTH', name: '\u571f', symbol: '\u25a0', primary: '#795548', secondary: '#4e342e', highlight: '#d9b58c', background: '#f7f1ed', dark: '#30221c', text: '#583a30', onPrimary: '#ffffff' },
  WOOD: { key: 'WOOD', name: '\u6728', symbol: '\u2663', primary: '#2e7d32', secondary: '#1b5e20', highlight: '#a4df71', background: '#eff8ed', dark: '#182f1b', text: '#235f27', onPrimary: '#ffffff' },
  THUNDER: { key: 'THUNDER', name: '\u96f7', symbol: '\u03df', primary: '#7b1fa2', secondary: '#4a1463', highlight: '#e1a5ff', background: '#f8effc', dark: '#2e1639', text: '#641883', onPrimary: '#ffffff' },
  WIND: { key: 'WIND', name: '\u98ce', symbol: '\u224b', primary: '#007f8b', secondary: '#005662', highlight: '#7be7e5', background: '#ecfafa', dark: '#123135', text: '#00616b', onPrimary: '#ffffff' },
  LIGHT: { key: 'LIGHT', name: '\u5149', symbol: '\u2600', primary: '#f2c230', secondary: '#856500', highlight: '#fff2a6', background: '#fffbe5', dark: '#332d15', text: '#685000', onPrimary: '#302500' },
  DARK: { key: 'DARK', name: '\u6697', symbol: '\u25c6', primary: '#202124', secondary: '#08090a', highlight: '#bdc4ce', background: '#f0f1f3', dark: '#111214', text: '#202124', onPrimary: '#ffffff' },
}

const unknown: ElementTheme = {
  key: 'UNKNOWN', name: '\u672a\u77e5', symbol: '?', primary: '#60656b', secondary: '#42464b',
  highlight: '#d9dde2', background: '#f3f4f5', dark: '#242629', text: '#42464b', onPrimary: '#ffffff',
}

export function getElementTheme(attribute?: string | null): ElementTheme {
  const key = String(attribute || '').toUpperCase()
  const aliases: Record<string, string> = { LIGHTNING: 'THUNDER', HOLY: 'LIGHT', SHADOW: 'DARK' }
  return ELEMENT_THEMES[aliases[key] || key] || unknown
}

export const getAttributeColor = (attribute: string) => getElementTheme(attribute).primary

export function elementThemeStyle(attribute?: string | null): CSSProperties {
  const theme = getElementTheme(attribute)
  return {
    '--element-primary': theme.primary,
    '--element-secondary': theme.secondary,
    '--element-highlight': theme.highlight,
    '--element-background': theme.background,
    '--element-dark': theme.dark,
    '--element-text': theme.text,
    '--element-on-primary': theme.onPrimary,
  } as CSSProperties
}
