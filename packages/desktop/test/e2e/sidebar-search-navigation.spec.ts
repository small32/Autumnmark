import { expect, test } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enterSourceMode, launchElectron, sendIpcToRenderer } from './helpers'

const HIT = 'search target phrase'

for (const sourceMode of [false, true]) {
  test(`folder search reveals the first result in an unopened ${sourceMode ? 'source' : 'rendered'} document`, async() => {
    const project = await mkdtemp(join(tmpdir(), 'autumnmark-search-navigation-'))
    const path = join(project, 'result.md')
    const lead = Array.from({ length: 110 }, (_, i) => `Paragraph ${i + 1}`).join('\n\n')
    await writeFile(path, `# Start\n\n${lead}\n\n${HIT}\n`, 'utf8')

    const { app, page } = await launchElectron([project], { windowLayout: { showSideBar: true } })
    try {
      if (sourceMode) await enterSourceMode(page, app)
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'findInFolder')
      const input = page.locator('.side-bar .search-input')
      await input.fill(HIT)
      await input.press('Enter')
      await page.locator('.search-result-item .matches li').first().click()

      if (sourceMode) {
        await expect.poll(() => page.locator('.CodeMirror').evaluate(element =>
          (element as Element & { CodeMirror?: { getSelection(): string } }).CodeMirror?.getSelection()
        )).toBe(HIT)
      } else {
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(HIT)
        await expect(page.locator('.editor-component').getByText(HIT, { exact: true })).toBeInViewport()
      }
    } finally {
      await app.close()
      await rm(project, { recursive: true, force: true })
    }
  })
}
