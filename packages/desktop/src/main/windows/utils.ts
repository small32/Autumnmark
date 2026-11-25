import { screen } from 'electron'
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'

export const zoomIn = (win: BrowserWindow | null | undefined): void => {
  if (!win) return
  const { webContents } = win
  const zoom = webContents.getZoomFactor()
  // WORKAROUND: We need to set zoom on the browser window due to Electron#16018.
  webContents.send('mt::window-zoom', Math.min(2.0, zoom + 0.125))
}

export const zoomOut = (win: BrowserWindow | null | undefined): void => {
  if (!win) return
  const { webContents } = win
  const zoom = webContents.getZoomFactor()
  // WORKAROUND: We need to set zoom on the browser window due to Electron#16018.
  webContents.send('mt::window-zoom', Math.max(0.5, zoom - 0.125))
}

export const resetZoom = (win: BrowserWindow | null | undefined): void => {
  if (!win) return
  const { webContents } = win
  // WORKAROUND: We need to set zoom on the browser window due to Electron#16018.
  webContents.send('mt::window-zoom', 1.0)
}

export const centerWindowOptions = (
  options: BrowserWindowConstructorOptions & {
    width: number
    height: number
    x?: number
    y?: number
  }
): void => {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width, height } = options
  options.x = Math.ceil(workArea.x + (workArea.width - width) / 2)
  options.y = Math.ceil(workArea.y + (workArea.height - height) / 2)
}
