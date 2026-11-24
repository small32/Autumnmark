import { randomUUID } from 'node:crypto'
import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { clickMenuById, launchWithMarkdown } from './helpers'

test('a file-based agent can edit a draft and request a screenshot through the shared Skill', async() => {
  const { app } = await launchWithMarkdown('Document', {
    preferences: { language: 'en', theme: 'light', followSystemTheme: false }
  })
  try {
    const home = await app.evaluate(({ app }) => {
      const home = app.getPath('userData')
      app.setPath('home', home)
      return home
    })
    const opened = app.waitForEvent('window')
    await clickMenuById(app, 'createThemeFromCurrent')
    const studio = await opened
    const external = studio.getByRole('button', { name: 'External collaboration', exact: true })
    const menu = studio.getByRole('dialog', { name: 'External collaboration' })
    const footer = studio.locator('footer')
    const status = footer.getByText('Collaboration active', { exact: true })
    await external.click()
    await menu.getByRole('button', { name: 'Install Skill' }).click()
    await expect(menu.getByRole('status')).toContainText('Antumnmark+ Skill installed')
    const skill = join(home, '.agents', 'skills', 'autumnmark-theme', 'SKILL.md')
    expect(await readFile(skill, 'utf8')).toContain('requests/<uuid>.json')
    await writeFile(skill, 'Locally customized Skill')
    await menu.getByRole('button', { name: 'Install Skill' }).click()
    await expect(menu.getByRole('status')).toContainText('already exists')
    expect(await readFile(skill, 'utf8')).toBe('Locally customized Skill')

    await menu.getByRole('button', { name: 'Start collaboration' }).click()
    await expect(menu.getByRole('button', { name: 'Copy folder path' })).toBeVisible()
    const directory = await menu.locator('code').innerText()
    const cssPath = join(directory, 'theme.css')
    const samplePath = join(directory, 'sample.md')
    const previews = join(directory, 'previews')
    const original = await readFile(samplePath, 'utf8')
    expect(original).toContain('# Ridge notes')
    expect(await readFile(join(directory, 'base.css'), 'utf8')).toContain('--editorColor')
    await external.click()
    await expect(menu).toBeHidden()
    await expect(status).toBeVisible()

    const css = ':root .mu-container h2.mu-atx-heading { background: #df1747 }'
    const sample = '# Shared draft\n\n## Preview one\n\n## Preview two'
    await writeFile(cssPath + '.tmp', css)
    await rename(cssPath + '.tmp', cssPath)
    await writeFile(samplePath, sample)
    const preview = studio.frameLocator('iframe')
    await expect(preview.locator('h1')).toContainText('Shared draft')
    await expect(preview.locator('h2').last()).toHaveCSS('background-color', 'rgb(223, 23, 71)')
    expect(await readdir(previews)).toEqual([])

    await studio.getByRole('button', { name: 'Markdown source', exact: true }).click()
    await expect(preview.locator('.CodeMirror-line').first()).toContainText('# Shared draft')
    const requestId = randomUUID()
    await writeFile(join(directory, 'requests', requestId + '.json'),
      JSON.stringify({ framing: 'node', selector: 'h2', occurrence: 2, slice: 1 }))
    const receipt = join(previews, requestId + '.json')
    await expect.poll(() => readFile(receipt, 'utf8').catch(() => '')).not.toBe('')
    expect(JSON.parse(await readFile(receipt, 'utf8'))).toMatchObject({ status: 'ok', image: 'previews/' + requestId + '.jpg' })
    const image = await readFile(join(previews, requestId + '.jpg'))
    expect([...image.subarray(0, 2)]).toEqual([255, 216])
    await expect(preview.locator('.CodeMirror-line').first()).toContainText('# Shared draft')
    await studio.getByRole('button', { name: 'Document', exact: true }).click()

    await writeFile(cssPath, 'h2 {')
    await expect(studio.getByRole('alert')).toContainText('Collaboration CSS needs attention')
    await expect(status).toBeVisible()
    await writeFile(cssPath, css)
    await expect(studio.getByRole('alert')).toHaveCount(0)
    await studio.getByRole('button', { name: 'Undo last change' }).click()
    await expect.poll(() => readFile(cssPath, 'utf8')).toBe('')
    await expect.poll(() => readFile(samplePath, 'utf8')).toBe(original)

    await studio.getByRole('button', { name: 'CSS source', exact: true }).click()
    await studio.getByRole('textbox', { name: 'CSS source' }).focus()
    await studio.keyboard.insertText('.mu-container h1 { color: teal }')
    await expect.poll(() => readFile(cssPath, 'utf8')).toBe('.mu-container h1 { color: teal }')
    await studio.reload()
    await external.click()
    await expect(menu.locator('code')).toHaveText(directory)
    await menu.getByRole('button', { name: 'Stop collaboration' }).click()
    await expect(menu.getByRole('button', { name: 'Start collaboration' })).toBeVisible()
    await expect(status).toHaveCount(0)
    await expect(footer.getByText('Draft saved on this device', { exact: true })).toBeVisible()
  } finally { await app.close() }
})
