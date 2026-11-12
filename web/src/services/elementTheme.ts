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
  FIRE: { key: 'FIRE', name: '\u706b', symbol: '\u25b2', primary: '#a85c58', secondary: '#7e4140', highlight: '#d99a91', background: '#f2d9d5', dark: '#3b2524', text: '#713c3b', onPrimary: '#ffffff' },
  WATER: { key: 'WATER', name: '\u6c34', symbol: '\u25cf', primary: '#5b86a4', secondary: '#41647b', highlight: '#9fc0d0', background: '#d9e9ef', dark: '#253944', text: '#365d76', onPrimary: '#ffffff' },
  EARTH: { key: 'EARTH', name: '\u571f', symbol: '\u25a0', primary: '#92776a', secondary: '#6f574e', highlight: '#c4a99b', background: '#e7ddd6', dark: '#382c27', text: '#624d43', onPrimary: '#ffffff' },
  WOOD: { key: 'WOOD', name: '\u6728', symbol: '\u2663', primary: '#6f956b', secondary: '#507151', highlight: '#a9c29e', background: '#dce8d8', dark: '#29392a', text: '#466c48', onPrimary: '#ffffff' },
  THUNDER: { key: 'THUNDER', name: '\u96f7', symbol: '\u03df', primary: '#886d9d', secondary: '#654d78', highlight: '#bca8c8', background: '#e4dbe9', dark: '#332b39', text: '#604b70', onPrimary: '#ffffff' },
  WIND: { key: 'WIND', name: '\u98ce', symbol: '\u224b', primary: '#5d9997', secondary: '#427572', highlight: '#9bc4bf', background: '#d8e9e7', dark: '#293d3c', text: '#3e706d', onPrimary: '#ffffff' },
  LIGHT: { key: 'LIGHT', name: '\u5149', symbol: '\u2600', primary: '#ad9560', secondary: '#806d43', highlight: '#d5c58f', background: '#f1e8c9', dark: '#3d3623', text: '#715c2f', onPrimary: '#302500' },
  DARK: { key: 'DARK', name: '\u6697', symbol: '\u25c6', primary: '#68717a', secondary: '#4d555d', highlight: '#aab2b8', background: '#d9dde0', dark: '#25292d', text: '#414a51', onPrimary: '#ffffff' },
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
