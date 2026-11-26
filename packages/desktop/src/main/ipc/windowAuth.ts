import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type Accessor from '../app/accessor'
import { type WindowTypeValue } from '../windows/base'

/** Ensure an IPC call comes from the main frame of an allowed window type. */
export const requireModelWindow = (app: Accessor, event: IpcMainInvokeEvent, ...types: WindowTypeValue[]): void => {
  const window = BrowserWindow.fromWebContents(event.sender)
  const owner = window && app.windowManager.get(window.id)
  if (!owner || event.senderFrame !== event.sender.mainFrame || !types.includes(owner.type)) throw new Error('invalidRequest')
}
