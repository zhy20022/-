const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const ts = require('typescript')
const context = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/elementTheme.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, context)
const { ELEMENT_THEMES, getElementTheme, elementThemeStyle } = context.exports
const luminance = hex => {
  const values = hex.match(/\w\w/g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722
}
const contrast = (a, b) => {
  const values = [luminance(a.slice(1)), luminance(b.slice(1))].sort((a, b) => b - a)
  return (values[0] + .05) / (values[1] + .05)
}
assert.equal(Object.keys(ELEMENT_THEMES).length, 8)
assert.equal(new Set(Object.values(ELEMENT_THEMES).map(theme => theme.symbol)).size, 8)
for (const [key, theme] of Object.entries(ELEMENT_THEMES)) {
  assert(theme.name && theme.symbol)
  for (const field of ['primary', 'secondary', 'highlight', 'background', 'dark', 'text', 'onPrimary'])
    assert.match(theme[field], /^#[0-9a-f]{6}$/)
  assert(contrast(theme.primary, theme.onPrimary) >= 4.5, `${key} badge contrast`)
  assert(contrast(theme.background, theme.text) >= 4.5, `${key} body contrast`)
  assert.equal(elementThemeStyle(key)['--element-primary'], theme.primary)
}
assert.equal(getElementTheme('LIGHTNING').key, 'THUNDER')
assert.equal(getElementTheme('holy').key, 'LIGHT')
assert.equal(getElementTheme('SHADOW').key, 'DARK')
assert.equal(getElementTheme('ICE').key, 'UNKNOWN', 'do not create a ninth game element')
assert.equal(getElementTheme(null).key, 'UNKNOWN')
assert.equal(ELEMENT_THEMES.WIND.primary, '#007f8b')
assert.equal(ELEMENT_THEMES.DARK.primary, '#202124')
console.log('PASS: eight element themes, unique symbols, aliases, unknown fallback and 4.5:1 text contrast')
