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

monaco.editor.defineTheme('projectos-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8A93A0', fontStyle: 'italic' },
    { token: 'keyword', foreground: '0A5CD6' },
    { token: 'string', foreground: '168F5B' },
    { token: 'number', foreground: 'B86B08' },
    { token: 'type', foreground: '8155C6' },
    { token: 'function', foreground: '0B76B7' },
  ],
  colors: {
    'editor.background': '#F7F8FA',
    'editor.foreground': '#17191E',
    'editorLineNumber.foreground': '#B5BCC7',
    'editorLineNumber.activeForeground': '#5F6774',
    'editor.selectionBackground': '#DCEBFF',
    'editor.lineHighlightBackground': '#FFFFFF',
    'editorCursor.foreground': '#1677FF',
    'editorIndentGuide.background1': '#E4E7EC',
    'editorIndentGuide.activeBackground1': '#C9CFD9',
    'editorWidget.background': '#FFFFFF',
    'editorWidget.border': 'rgba(18,28,45,.10)',
    'editorSuggestWidget.background': '#FFFFFF',
    'editorSuggestWidget.border': 'rgba(18,28,45,.10)',
    'scrollbarSlider.background': 'rgba(18,28,45,.14)',
    'scrollbarSlider.hoverBackground': 'rgba(18,28,45,.24)',
  },
})

monaco.editor.defineTheme('projectos-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '7B8494', fontStyle: 'italic' },
    { token: 'keyword', foreground: '9AC8FF' },
    { token: 'string', foreground: '4ED39A' },
    { token: 'number', foreground: 'F0B45C' },
    { token: 'type', foreground: 'C0A6FF' },
    { token: 'function', foreground: '6CC7F5' },
  ],
  colors: {
    'editor.background': '#0E1117',
    'editor.foreground': '#F3F5F9',
    'editorLineNumber.foreground': '#4E5665',
    'editorLineNumber.activeForeground': '#A6AEBC',
    'editor.selectionBackground': '#1E3654',
    'editor.lineHighlightBackground': '#141820',
    'editorCursor.foreground': '#6FAEFF',
    'editorIndentGuide.background1': '#1D222D',
    'editorIndentGuide.activeBackground1': '#323A48',
    'editorWidget.background': '#14171F',
    'editorWidget.border': 'rgba(255,255,255,.12)',
    'editorSuggestWidget.background': '#14171F',
    'editorSuggestWidget.border': 'rgba(255,255,255,.12)',
    'scrollbarSlider.background': 'rgba(255,255,255,.12)',
    'scrollbarSlider.hoverBackground': 'rgba(255,255,255,.22)',
  },
})
