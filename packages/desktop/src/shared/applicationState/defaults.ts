import { blankDrawing, isDrawingPath } from '../drawing'
import { SessionLifecycle } from '../types/applicationState'
import type { ApplicationState, DocumentSnapshot, WindowLayoutState } from '../types/applicationState'

export const emptyDocumentBody = ({
  resource,
  title
}: Pick<DocumentSnapshot, 'resource' | 'title'>): string =>
  resource.kind === 'untitled' && isDrawingPath(title) ? blankDrawing : ''

export const createDefaultLayout = (
  preferences: { sourceCodeModeEnabled: boolean } = { sourceCodeModeEnabled: false }
): WindowLayoutState => ({
  sidebar: {
    visible: false,
    activeView: 'files',
    preferredWidthPx: 280,
    openedFiles: { expanded: true, preferredHeightPx: 112 }
  },
  tabBar: { visible: false },
  modes: { sourceCode: preferences.sourceCodeModeEnabled, focus: false, typewriter: false }
})

export const createEmptyApplicationState = (
  sessionId: string,
  nowMs: number
): ApplicationState => ({
  schemaVersion: 1,
  revision: 0,
  updatedAtMs: nowMs,
  session: {
    id: sessionId,
    lifecycle: SessionLifecycle.RUNNING,
    windows: [],
    activeWindowId: null,
    lastWindow: null
  },
  lastActiveWorkspaceId: null,
  recentWorkspaces: [],
  recentEmptyWindowLayout: null
})
