import { elementThemeStyle, getElementTheme } from '../services/elementTheme'
import './ElementBadge.css'

export default function ElementBadge({ attribute }: { attribute?: string | null }) {
  const theme = getElementTheme(attribute)
  return (
    <span className="element-badge" style={elementThemeStyle(attribute)} data-element={theme.key}>
      <span className="element-symbol" aria-hidden="true">{theme.symbol}</span>
      <span>{theme.name}</span>
    </span>
  )
}
