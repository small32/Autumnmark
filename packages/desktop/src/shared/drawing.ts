export const isDrawingPath = (path: string) => /\.excalidraw$/i.test(path)

export function drawingFilename(filename: string): string | undefined {
  if (typeof filename !== 'string') return
  const value = filename.trim()
  const stem = isDrawingPath(value) ? value.slice(0, -'.excalidraw'.length).trimEnd() : value
  if (!stem || stem.endsWith('.') || /[<>:"/\\|?*]/.test(stem) ||
    Array.from(stem).some(character => character.charCodeAt(0) < 32) ||
    /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) return
  return `${stem}.excalidraw`
}

export const blankDrawing = JSON.stringify({
  type: 'excalidraw', version: 2, source: 'AutumnMark', elements: [], appState: {}, files: {}
})
