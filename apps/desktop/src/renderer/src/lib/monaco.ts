import { lightPalette, darkPalette, type ThemePalette } from '@projectos/design-tokens'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}

loader.config({ monaco })

const tint=(color:string,alpha:string)=>color.startsWith('#')?`${color.slice(0,7)}${alpha}`:color
// Monaco accepts hex colors; passing the design system's rgba tokens produces red fallbacks.
function editorColor(value:string){
  const rgba=/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(value)
  if(!rgba)return value
  return '#'+rgba.slice(1,4).map(n=>Math.round(Number(n)).toString(16).padStart(2,'0')).join('')+(rgba[4]===undefined?'':Math.round(Number(rgba[4])*255).toString(16).padStart(2,'0'))
}
const editorColors = (palette: ThemePalette) => Object.fromEntries(Object.entries({
  'diffEditor.insertedLineBackground':tint(palette.success,'18'),
  'diffEditor.removedLineBackground':tint(palette.danger,'18'),
  'diffEditor.insertedTextBackground':tint(palette.success,'35'),
  'diffEditor.removedTextBackground':tint(palette.danger,'35'),
  'diffEditorGutter.insertedLineBackground':tint(palette.success,'55'),
  'diffEditorGutter.removedLineBackground':tint(palette.danger,'55'),
  'editor.background': palette.surface,
  'editor.foreground': palette.textPrimary,
  'editorLineNumber.foreground': palette.textSecondary,
  'editorLineNumber.activeForeground': palette.textPrimary,
  'editor.selectionBackground': palette.accentSoft,
  'editor.lineHighlightBackground': palette.surfaceHover,
  'editorCursor.foreground': palette.accent,
  'editorIndentGuide.background1': palette.border,
  'editorIndentGuide.activeBackground1': palette.borderStrong,
  'editorWidget.background': palette.surfaceRaised,
  'editorWidget.border': palette.border,
  'editorSuggestWidget.background': palette.surfaceRaised,
  'editorSuggestWidget.border': palette.border,
  'scrollbarSlider.background': palette.scrollbar,
  'scrollbarSlider.hoverBackground': palette.scrollbarHover,
}).map(([key,value])=>[key,editorColor(value)]))

for (const [mode, palette] of [['light', lightPalette], ['dark', darkPalette]] as const) {
  monaco.editor.defineTheme(`projectos-${mode}`, {
    base: mode === 'light' ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      // Diff backgrounds reduce secondary text contrast; keep source comments fully legible.
      { token: 'comment', foreground: palette.textPrimary.slice(1) },
      { token: 'keyword', foreground: palette.accentStrong.slice(1) },
      { token: 'string', foreground: palette.success.slice(1) },
      { token: 'number', foreground: palette.warning.slice(1) },
      { token: 'type', foreground: palette.accentStrong.slice(1) },
      { token: 'function', foreground: palette.info.slice(1) },
    ],
    colors: editorColors(palette),
  })
}
