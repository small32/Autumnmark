import { expect, test } from '@playwright/test'
import type CodeMirror from 'codemirror'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { blankDrawing } from '../../src/shared/drawing'
import type { MenuTemplate } from '../../src/shared/types/menu'
import { clickMenuById, enterSourceMode, getMarkdownContent, launchElectron, launchWithMarkdown, sendIpcToRenderer } from './helpers'

const blankDrawingFence = `\`\`\`excalidraw\n${blankDrawing}\n\`\`\``
const blankInlineDrawing = `![Embedded drawing](data:application/x-excalidraw;base64,${Buffer.from(blankDrawing).toString('base64')})`

function inlineScenes(markdown: string) {
  return [...markdown.matchAll(/!\[[^\]]*\]\(data:application\/x-excalidraw;base64,([\w+/=]+)\)/g)]
    .map(([, source]) => JSON.parse(Buffer.from(source, 'base64').toString('utf8')))
}

test('places the caret between each pair of consecutive drawings', async() => {
  const { app, page } = await launchWithMarkdown(blankInlineDrawing.repeat(3), {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const drawings = page.locator('.mu-editor .mu-inline-drawing')
    const gaps = page.locator('.mu-editor .mu-drawing-gap')
    await expect(drawings.getByRole('img')).toHaveCount(3)
    await expect(gaps).toHaveCount(2)
    await drawings.first().focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')
    await expect(drawings.nth(1).locator('xpath=preceding-sibling::*[1][@data-mu-image-caret="start"]')).toHaveCount(1)
    await page.keyboard.press('ArrowRight')
    await expect(drawings.nth(2).locator('xpath=preceding-sibling::*[1][@data-mu-image-caret="start"]')).toHaveCount(1)
    await page.keyboard.press('ArrowLeft')
    await expect(drawings.nth(1).locator('xpath=preceding-sibling::*[1][@data-mu-image-caret="start"]')).toHaveCount(1)
    await page.keyboard.insertText('一')
    await expect(gaps).toHaveCount(1)
    const [gap, second] = await Promise.all([gaps.boundingBox(), drawings.nth(1).boundingBox()])
    if (!gap || !second) throw new Error('Missing drawing or gap bounds')
    await page.mouse.click(gap.x + gap.width / 2, second.y + second.height / 2)
    await expect(page.getByRole('dialog', { name: 'Embedded drawing' })).toBeHidden()
    await page.keyboard.insertText('二')
    await expect(drawings).toHaveCount(3)
    expect((await getMarkdownContent(page, app)).trim()).toBe(`${blankInlineDrawing}一${blankInlineDrawing}二${blankInlineDrawing}`)
  } finally {
    await app.close()
  }
})

test('puts an editable caret between consecutive legacy drawing fences', async() => {
  const fences = Array.from({ length: 3 }, (_, index) =>
    blankDrawingFence.replace('"appState":{}', `"appState":{"viewBackgroundColor":"#eeee0${index}"}`))
  const { app, page } = await launchWithMarkdown(['Before', ...fences, 'After'].join('\n\n'), {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const editor = page.locator('.mu-editor')
    const drawings = editor.locator('.mu-embedded-drawing-block')
    const gaps = editor.locator('.mu-embedded-drawing-gap:visible')
    await expect(drawings.getByRole('img')).toHaveCount(3)
    await expect(gaps).toHaveCount(2)
    await gaps.first().click()
    await expect(page.getByRole('dialog', { name: 'Embedded drawing' })).toBeHidden()
    await page.keyboard.insertText('第一处')
    await expect(drawings.nth(0).locator('xpath=following-sibling::*[1]')).toHaveText('第一处')

    await drawings.nth(2).getByRole('button').focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.insertText('第二处')
    await expect(drawings.nth(1).locator('xpath=following-sibling::*[1]')).toHaveText('第二处')
    expect((await getMarkdownContent(page, app)).trim())
      .toBe(['Before', fences[0], '第一处', fences[1], '第二处', fences[2], 'After'].join('\n\n'))
  } finally {
    await app.close()
  }
})

test('places a caret beside a legacy drawing and keeps the scene when typing inline', async() => {
  const { app, page } = await launchWithMarkdown(Array(3).fill(blankDrawingFence).join('\n\n'), {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const editor = page.locator('.mu-editor')
    const legacy = editor.locator('.mu-embedded-drawing-block')
    const inline = editor.locator('.mu-inline-drawing')
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    const preview = legacy.nth(1).getByRole('img')
    await expect(preview).toBeVisible()
    const bounds = await preview.boundingBox()
    if (!bounds) throw new Error('Missing legacy preview bounds')
    await page.mouse.click(bounds.x - 12, bounds.y + bounds.height / 2)
    await expect(popup).toBeHidden()
    await expect(inline).toBeVisible()
    await clickMenuById(app, 'undoMenuItem')
    await expect(legacy).toHaveCount(3)

    await expect(preview).toBeVisible()
    const restored = await preview.boundingBox()
    if (!restored) throw new Error('Missing restored preview bounds')
    await page.mouse.click(restored.x + restored.width + 12, restored.y + restored.height / 2)
    await expect(popup).toBeHidden()
    await page.keyboard.insertText('右侧')
    await inline.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.insertText('左侧')
    expect((await getMarkdownContent(page, app)).trim()).toBe(
      [blankDrawingFence, `左侧${blankInlineDrawing}右侧`, blankDrawingFence].join('\n\n')
    )
  } finally {
    await app.close()
  }
})

test('shows source drawings as atomic chips and opens the drawing under the clicked chip', async() => {
  const sourceMarkdown = `${blankInlineDrawing.repeat(2)}\n\n> ${blankDrawingFence.replace(/\n/g, '\n> ')}\n\n![Linked](linked.excalidraw)\n`
  const { app, page, filePath } = await launchWithMarkdown(sourceMarkdown, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    await writeFile(join(dirname(filePath), 'linked.excalidraw'), blankDrawing)
    await enterSourceMode(page, app)
    const source = page.locator('.source-code .CodeMirror')
    const chips = source.locator('.embedded-drawing-chip')
    await expect(chips).toHaveCount(4)
    await expect(source.locator('.CodeMirror-code')).toHaveText(/^(?![\s\S]*(?:base64|appState|\x60{3}))[\s\S]*$/)
    expect((await getMarkdownContent(page, app)).trim()).toBe(sourceMarkdown.trim())

    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await chips.nth(1).click()
    await popup.getByRole('tab', { name: 'Source' }).click()
    const editor = popup.getByRole('textbox', { name: 'Excalidraw JSON' })
    const scene = JSON.parse(await editor.inputValue())
    scene.appState.viewBackgroundColor = '#ccbbaa'
    await editor.fill(JSON.stringify(scene))
    await popup.click({ position: { x: 8, y: 8 } })
    const confirm = page.locator('.el-message-box').filter({ hasText: 'Discard the unapplied changes to the drawing source?' })
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(popup).toBeVisible()
    await popup.getByRole('button', { name: 'Apply' }).click()
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[1]?.appState.viewBackgroundColor).toBe('#ccbbaa')
    const updated = await getMarkdownContent(page, app)
    expect(inlineScenes(updated)[0]).toEqual(JSON.parse(blankDrawing))
    expect(updated).toContain('> ```excalidraw')
    await popup.click({ position: { x: 8, y: 8 } })
    await expect(popup).toBeHidden()

    await chips.nth(2).click()
    await expect(popup).toBeVisible()
    await popup.click({ position: { x: 8, y: 8 } })
    await expect(popup).toBeHidden()
    await chips.nth(3).click()
    const linked = page.getByRole('dialog', { name: 'linked.excalidraw' })
    await expect(linked).toBeVisible()
    await linked.click({ position: { x: 8, y: 8 } })
    await expect(linked).toBeHidden()

    await source.evaluate((element, ch) => {
      const cm = (element as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror
      cm.focus()
      cm.setCursor({ line: 0, ch })
    }, blankInlineDrawing.length)
    await page.keyboard.insertText('之间')
    expect((await getMarkdownContent(page, app)).startsWith(`${blankInlineDrawing}之间![Embedded drawing](`)).toBe(true)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Backspace')
    await expect(chips).toHaveCount(3)
    expect(inlineScenes(await getMarkdownContent(page, app))).toEqual([JSON.parse(blankDrawing)])
  } finally {
    await app.close()
  }
})

test('keeps an inline drawing between editable text and opens only from the preview', async() => {
  const { app, page } = await launchWithMarkdown(`Before ${blankInlineDrawing} After\n`, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const editor = page.locator('.mu-editor')
    const paragraph = editor.locator('.mu-paragraph')
    const drawing = paragraph.locator('.mu-inline-drawing')
    const preview = drawing.getByRole('img')
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(preview).toBeVisible()
    await expect(paragraph).toHaveText('Before After')
    const bounds = await preview.boundingBox()
    if (!bounds) throw new Error('Missing preview bounds')
    await page.mouse.click(bounds.x - 4, bounds.y + bounds.height / 2)
    await expect(popup).toBeHidden()
    await page.keyboard.insertText('Left')
    await expect(paragraph).toHaveText(/^Before\s*Left\s*After$/)
    await drawing.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.insertText('Right')
    await expect(paragraph).toHaveText(/Right After$/)
    await drawing.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    await expect(paragraph).toHaveCount(2)
    await expect(paragraph.nth(1).locator('.mu-inline-drawing')).toBeVisible()
    await drawing.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(paragraph).toHaveCount(3)
    await expect(paragraph.nth(1)).toHaveText('')
    await expect(paragraph.nth(2)).toHaveText('Right After')
    await clickMenuById(app, 'undoMenuItem')
    await expect(paragraph).toHaveCount(2)
    await clickMenuById(app, 'undoMenuItem')
    await expect(paragraph).toHaveCount(1)
    await preview.click()
    await expect(popup).toBeVisible()
  } finally {
    await app.close()
  }
})

test('saves only the clicked inline drawing among identical scenes', async() => {
  const markdown = `${blankDrawingFence}\n\n${blankInlineDrawing}\n\n> Before ${blankInlineDrawing} After\n`
  const { app, page, filePath } = await launchWithMarkdown(markdown, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const drawings = page.locator('.mu-editor .mu-inline-drawing')
    await expect(drawings).toHaveCount(2)
    await drawings.nth(1).focus()
    await page.keyboard.press('Enter')
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await popup.getByRole('tab', { name: 'Source' }).click()
    const source = popup.getByRole('textbox', { name: 'Excalidraw JSON' })
    const scene = JSON.parse(await source.inputValue())
    scene.appState.viewBackgroundColor = '#ffeedd'
    await source.fill(JSON.stringify(scene))
    await popup.getByRole('button', { name: 'Apply' }).click()
    await expect.poll(async() => inlineScenes(await readFile(filePath, 'utf8'))[1]?.appState.viewBackgroundColor).toBe('#ffeedd')
    const saved = (await readFile(filePath, 'utf8')).replace(/\r\n/g, '\n')
    expect(saved).toContain(blankDrawingFence)
    expect(inlineScenes(saved)[0]).toEqual(JSON.parse(blankDrawing))

    await popup.locator('.el-dialog__headerbtn').click()
    const htmlPath = join(dirname(filePath), 'inline-drawing.html')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async() => ({ canceled: false, filePath: path })
    }, htmlPath)
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'styledHtml')
    await page.locator('.print-settings-dialog .button-primary').click()
    await expect.poll(() => readFile(htmlPath, 'utf8').catch(() => '')).toMatch(/<p>Before <img[^>]+src="data:image\/png;base64,[^>]+> After<\/p>/)
  } finally {
    await app.close()
  }
})

test('places an editable caret on both sides of a drawing at the document boundary', async() => {
  const { app, page } = await launchWithMarkdown(blankDrawingFence, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const editor = page.locator('.mu-editor')
    const drawing = editor.locator('.mu-embedded-drawing-block')
    const preview = drawing.getByRole('img')
    await expect(preview).toBeVisible()
    await drawing.getByRole('button').focus()
    await expect(drawing.getByRole('button')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    const after = editor.locator('.mu-embedded-drawing-block + .mu-paragraph')
    await expect(after).toBeVisible()
    await page.keyboard.insertText('After')
    await expect(after).toHaveText('After')

    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowLeft')
    const before = editor.locator('.mu-paragraph:has(+ .mu-embedded-drawing-block)')
    await expect(before).toBeVisible()
    await page.keyboard.insertText('Before')
    await expect(before).toHaveText('Before')

    await page.keyboard.press('ArrowRight')
    await page.keyboard.insertText('Still ')
    await expect(after).toHaveText('Still After')
  } finally {
    await app.close()
  }
})

test('deletes an adjacent drawing without losing the caret or jumping to the top', async() => {
  const prefix = Array.from({ length: 40 }, (_, index) => `Paragraph ${index + 1}`).join('\n\n')
  const markdown = `${prefix}\n\nBefore the drawing\n\n${blankDrawingFence}\n\nAfter the drawing\n`
  const { app, page } = await launchWithMarkdown(markdown, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    const editor = page.locator('.mu-editor')
    const drawing = editor.locator('.mu-embedded-drawing-block')
    const before = editor.getByText('Before the drawing', { exact: true })
    const after = editor.getByText('After the drawing', { exact: true })
    const scrollTop = () => editor.evaluate(element => element.scrollTop)
    const caret = () => page.evaluate(() => {
      const selection = document.getSelection()
      return [selection?.anchorNode?.textContent, selection?.anchorOffset]
    })

    await after.click()
    await page.keyboard.press('Home')
    await expect.poll(scrollTop).toBeGreaterThan(500)
    await page.keyboard.press('Backspace')
    await expect(drawing).toHaveCount(0)
    await expect.poll(caret).toEqual(['After the drawing', 0])
    await expect.poll(scrollTop).toBeGreaterThan(500)

    await clickMenuById(app, 'undoMenuItem')
    await expect(drawing.getByRole('img')).toBeVisible()
    await before.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Delete')
    await expect(drawing).toHaveCount(0)
    await expect.poll(caret).toEqual(['Before the drawing', 'Before the drawing'.length])
    await expect(after).toBeVisible()
    await expect.poll(scrollTop).toBeGreaterThan(500)
  } finally {
    await app.close()
  }
})

test('embeds drawings by default and edits them after reopening the Markdown', async() => {
  const { app, page, filePath } = await launchWithMarkdown('# Release plan\n\n- Check the build\n', { preferences: { language: 'en', autoSave: false } })
  const directory = dirname(filePath)
  const cardPath = join(directory, 'notes', 'release-plan.md')
  const copyPath = join(directory, 'drawing-copy.md')
  const pdfPath = join(directory, 'embedded-drawing.pdf')
  const readScene = async(pathname: string) => {
    const markdown = await readFile(pathname, 'utf8')
    return inlineScenes(markdown)[0]
  }
  try {
    await mkdir(dirname(cardPath), { recursive: true })
    await writeFile(cardPath, '# Release plan\n\n- Check the build\n')
    await writeFile(join(directory, basename(cardPath)), '# Other document\n')
    await page.evaluate(path => window.electron.ipcRenderer.send('mt::window::drop', [path]), directory)
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [filePath] })
    }, cardPath)
    await clickMenuById(app, 'newDrawingMenuItem')
    const canvas = page.locator('.drawing-workspace:visible')
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(popup).toBeVisible()
    const addCard = async(browse = false) => {
      await canvas.getByRole('button', { name: 'Add Document' }).click()
      if (browse) {
        await canvas.getByRole('button', { name: 'Browse Files…' }).click()
      } else {
        const search = canvas.getByRole('combobox', { name: 'Search Markdown documents' })
        await search.fill('notes/release')
        await canvas.getByRole('option', { name: /release-plan\.md.*notes/ }).click()
      }
      await canvas.getByLabel(basename(cardPath)).selectOption('release-plan')
      await canvas.getByRole('button', { name: 'Add Card', exact: true }).click()
    }
    await addCard()
    await canvas.getByRole('button', { name: 'Insert into Document' }).click()
    await expect(canvas).toBeHidden()

    const preview = page.getByRole('img', { name: 'Embedded drawing' })
    await expect(preview).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect.poll(() => readScene(filePath)).toMatchObject({
      type: 'excalidraw',
      elements: [{ type: 'image' }]
    })
    const scene = await readScene(filePath)
    expect(scene.files[scene.elements[0].fileId].dataURL).toMatch(/^data:image\/png;base64,/)
    expect((await readdir(directory)).filter(name => name.endsWith('.excalidraw'))).toEqual([])

    await writeFile(copyPath, await readFile(filePath))
    await page.evaluate(pathname => window.electron.ipcRenderer.send('mt::open-file', pathname, { preview: false }), copyPath)
    await expect(page.locator('.editor-tabs li.active')).toHaveText(basename(copyPath))
    await expect(preview).toHaveAttribute('src', /^data:image\/png;base64,/)
    await preview.click()
    await expect(popup).toBeVisible()
    const toolbar = popup.locator('.drawing-toolbar')
    await expect(toolbar.getByRole('tablist')).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Add Document' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Open in Tab' })).toBeVisible()
    await expect(popup.getByRole('tab', { name: 'Canvas' })).toHaveAttribute('aria-selected', 'true')
    await popup.getByRole('tab', { name: 'Source' }).click()
    const source = popup.getByRole('textbox', { name: 'Excalidraw JSON' })
    const initial = JSON.parse(await source.inputValue())
    expect(initial.elements).toHaveLength(1)
    await source.fill('{')
    await popup.getByRole('button', { name: 'Apply' }).click()
    await expect(popup.getByRole('alert')).toContainText('The drawing source is invalid')
    expect((await readScene(copyPath)).appState.viewBackgroundColor).toBe(initial.appState.viewBackgroundColor)
    await popup.getByRole('button', { name: 'Discard changes' }).click()
    expect(JSON.parse(await source.inputValue())).toEqual(initial)
    initial.appState.viewBackgroundColor = '#ffeedd'
    await source.fill(JSON.stringify(initial))
    await popup.getByRole('button', { name: 'Apply' }).click()
    await expect.poll(async() => (await readScene(copyPath)).appState.viewBackgroundColor).toBe('#ffeedd')
    await popup.getByRole('tab', { name: 'Canvas' }).click()
    await addCard(true)
    await expect.poll(async() => (await readScene(copyPath))?.elements.length).toBe(2)
    await popup.getByRole('button', { name: 'Open in Tab' }).click()
    await expect(popup).toBeHidden()
    const drawingTab = page.locator('.editor-tabs li.active')
    await expect(drawingTab).toHaveText('Embedded drawing.excalidraw')
    await addCard()
    await drawingTab.locator('.close-icon').click()
    await expect(page.locator('.editor-tabs li.active')).toHaveText(basename(copyPath))
    await expect.poll(async() => (await readScene(copyPath))?.elements.length).toBe(3)
    expect((await readScene(filePath)).elements).toHaveLength(1)

    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async() => ({ canceled: false, filePath })
    }, pdfPath)
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'pdf')
    await page.locator('.print-settings-dialog .button-primary').click()
    await expect.poll(async() => {
      const pdf = await readFile(pdfPath).catch(() => Buffer.alloc(0))
      return { size: pdf.length, image: /\/Subtype\s*\/Image\b/.test(pdf.toString('latin1')) }
    }, { timeout: 8000 }).toMatchObject({ image: true })
  } finally {
    await app.close()
  }
})

test('inserts a drawing from the context menu and autosaves edits to the linked file', async() => {
  const { app, page, filePath } = await launchWithMarkdown('# 发布清单\n\n- 检查构建\n', {
    preferences: { language: 'en', embedDrawings: false, newDrawingView: 'tab', autoSave: false }
  })
  const occupiedPath = join(dirname(filePath), 'Untitled Drawing.excalidraw')
  const drawingPath = join(dirname(filePath), 'Untitled Drawing 2.excalidraw')
  const pdfPath = join(dirname(filePath), 'drawing-export.pdf')
  try {
    await writeFile(occupiedPath, 'existing drawing')
    await app.evaluate(({ dialog, ipcMain }, filePath) => {
      dialog.showSaveDialog = async() => ({ canceled: true, filePath: '' })
      dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [filePath] })
      ipcMain.removeAllListeners('mt::menu::popup')
      ipcMain.on('mt::menu::popup', (event, template: MenuTemplate) => {
        const item = template.find(item => item.id?.startsWith('newDrawing-') && item.enabled)
        if (item) event.sender.send('mt::menu::click', { id: item.id })
        event.sender.send('mt::menu::closed', {})
      })
    }, filePath)
    await page.locator('.mu-editor').dispatchEvent('contextmenu', { bubbles: true, cancelable: true })

    const canvas = page.locator('.drawing-workspace:visible')
    await expect(page.locator('.editor-tabs li.active')).toHaveText(basename(drawingPath))
    await expect(canvas.getByRole('button', { name: 'Insert into Document' })).toHaveCount(0)
    await expect.poll(() => readFile(filePath, 'utf8')).toContain('Untitled%20Drawing%202.excalidraw)')
    expect(await readFile(occupiedPath, 'utf8')).toBe('existing drawing')
    await expect(page.locator('.editor-tabs')).toBeVisible()
    const tabs = page.locator('.editor-tabs')
    await expect(tabs.getByRole('button', { name: 'New Tab', exact: true })).toBeVisible()
    await expect(tabs.getByRole('button', { name: 'New Excalidraw Drawing', exact: true })).toHaveCount(0)
    await expect(page.locator('.editor-tabs li')).toHaveCount(2)
    await expect(canvas.locator('.excalidraw canvas').first()).toBeVisible()
    const addCard = async() => {
      await canvas.getByRole('button', { name: 'Add Document' }).click()
      await expect(canvas.getByText('Opened files', { exact: true })).toBeVisible()
      await canvas.getByRole('option').filter({ hasText: basename(filePath) }).click()
      await canvas.getByLabel(basename(filePath)).selectOption('发布清单')
      await canvas.getByRole('button', { name: 'Add Card', exact: true }).click()
    }
    await addCard()
    await expect.poll(async() => JSON.parse(await readFile(drawingPath, 'utf8')).elements.length).toBe(1)
    const drawingTab = page.locator(`.editor-tabs li[aria-label="${basename(drawingPath)}"]`)
    await expect(drawingTab).toBeVisible()
    await drawingTab.locator('.close-icon').click()
    await expect(canvas).toBeHidden()

    const savedDrawing = await readFile(drawingPath, 'utf8')
    const content = JSON.parse(savedDrawing)
    expect(content.type).toBe('excalidraw')
    expect(content.elements).toHaveLength(1)
    const [card] = content.elements
    expect(card.customData.autumnmarkDocument).toEqual({ path: basename(filePath), heading: '发布清单' })
    expect(content.files[card.fileId].dataURL).toMatch(/^data:image\/png;base64,/)

    const preview = page.getByRole('img', { name: 'Untitled Drawing 2' })
    await expect(preview).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect.poll(() => preview.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect.poll(() => readFile(filePath, 'utf8')).toContain('.excalidraw)')

    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async() => ({ canceled: false, filePath })
    }, pdfPath)
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'pdf')
    await page.locator('.print-settings-dialog .button-primary').click()
    await expect.poll(async() => {
      const pdf = await readFile(pdfPath).catch(() => Buffer.alloc(0))
      return /\/Subtype\s*\/Image\b/.test(pdf.toString('latin1'))
    }).toBe(true)

    await preview.click()
    const popup = page.getByRole('dialog', { name: basename(drawingPath) })
    await expect(popup).toBeVisible()
    await expect(canvas.locator('.excalidraw canvas').first()).toBeVisible()
    await expect(page.locator('.editor-tabs li')).toHaveCount(1)
    await addCard()
    await expect.poll(async() => JSON.parse(await readFile(drawingPath, 'utf8')).elements.length).toBe(2)
    await popup.getByRole('button', { name: 'Open in Tab' }).click()
    await expect(popup).toBeHidden()
    await expect(canvas.locator('canvas.interactive')).toBeVisible()
    await expect(page.locator('.editor-tabs li.active')).toHaveText(basename(drawingPath))
    await addCard()
    await drawingTab.locator('.close-icon').click()
    await expect.poll(async() => JSON.parse(await readFile(drawingPath, 'utf8')).elements.length).toBe(3)
  } finally {
    await app.close()
  }
})

test('the insertion shortcut respects embedding and transfers a new drawing to a tab', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Draw here', {
    windowLayout: { showTabBar: true },
    preferences: { language: 'en', embedDrawings: true, autoSave: false }
  })
  try {
    const recentPath = join(dirname(filePath), 'previous-plan.md')
    await writeFile(recentPath, '# Previous plan\n')
    await page.evaluate(path => window.electron.ipcRenderer.send('mt::open-file', path, { preview: false }), recentPath)
    const activeTab = page.locator('.editor-tabs li.active')
    await expect(activeTab).toHaveText(basename(recentPath))
    await expect(activeTab).toBeVisible()
    await activeTab.locator('.close-icon').click()
    await expect(activeTab).toHaveText(basename(filePath))
    await page.locator('.mu-editor .mu-paragraph').click()
    await page.keyboard.press('End')
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
    const browserWindow = await app.browserWindow(page)
    await browserWindow.evaluate(win => {
      const modifiers: ('meta' | 'control' | 'shift')[] = [process.platform === 'darwin' ? 'meta' : 'control', 'shift']
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers })
    })
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(popup).toBeVisible()
    await expect.poll(() => readFile(filePath, 'utf8')).toMatch(/Draw!\[Embedded drawing\]\(data:application\/x-excalidraw;base64,[\w+/=]+\) here/)
    await expect(popup.getByRole('button', { name: 'Insert into Document' })).toHaveCount(0)
    const addDocument = popup.getByRole('button', { name: 'Add Document' })
    const documentPanel = popup.getByRole('group', { name: 'Add Document' })
    const search = popup.getByRole('combobox', { name: 'Search Markdown documents' })
    const canvas = popup.locator('.drawing-canvas')
    const canvasLayout = () => canvas.evaluate((element: HTMLDivElement) => ({
      top: element.offsetTop,
      left: element.offsetLeft,
      width: element.offsetWidth,
      height: element.offsetHeight
    }))
    await expect(canvas.locator('canvas.interactive')).toBeVisible()
    const initialCanvasLayout = await canvasLayout()
    await addDocument.click()
    await expect(search).toBeFocused()
    expect(await canvasLayout()).toEqual(initialCanvasLayout)
    await search.press('Escape')
    await expect(popup).toBeVisible()
    await expect(addDocument).toBeFocused()
    await expect(documentPanel).toBeHidden()
    await addDocument.click()
    await expect(search).toBeFocused()
    await popup.getByRole('tab', { name: 'Canvas' }).click()
    await expect(documentPanel).toBeHidden()
    await addDocument.click()
    await expect(popup.getByText('recently opened', { exact: true })).toBeVisible()
    await expect(popup.getByRole('option').filter({ hasText: basename(filePath) })).toHaveCount(1)
    await search.fill('previous-plan')
    await expect(popup.getByRole('option').filter({ hasText: basename(recentPath) })).toBeVisible()
    await search.press('Enter')
    await expect(popup.getByLabel(basename(recentPath))).toBeFocused()
    expect(await canvasLayout()).toEqual(initialCanvasLayout)
    await popup.getByRole('button', { name: 'Add Card', exact: true }).click()
    await expect(documentPanel).toBeHidden()
    await popup.getByRole('button', { name: 'Open in Tab' }).click()
    await expect(popup).toBeHidden()
    await expect.poll(async() => {
      const markdown = await readFile(filePath, 'utf8')
      return inlineScenes(markdown)[0]?.elements.length
    }).toBe(1)
    expect((await readdir(dirname(filePath))).filter(name => name.endsWith('.excalidraw'))).toEqual([])
  } finally {
    await app.close()
  }
})

test('inserts an embedded drawing in an untitled note without opening Save As', async() => {
  const { app, page } = await launchElectron([], {
    preferences: { language: 'en', embedDrawings: true, autoSave: false }
  })
  try {
    const saveDialogs = await app.evaluateHandle(({ dialog }) => {
      const calls: string[] = []
      dialog.showSaveDialog = async() => {
        calls.push('save')
        return { canceled: true, filePath: '' }
      }
      return calls
    })
    await expect(page.locator('.mu-editor .mu-paragraph')).toBeVisible()
    await sendIpcToRenderer(app, 'mt::execute-command-by-id', 'drawing.insert')
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(popup).toBeVisible()
    await expect(popup.getByRole('button', { name: 'Insert into Document' })).toHaveCount(0)
    await popup.locator('.el-dialog__headerbtn').click()
    await expect(popup).toBeHidden()
    const drawing = page.locator('.mu-inline-drawing')
    const preview = drawing.getByRole('img')
    await expect(preview).toBeVisible()
    const bounds = await preview.boundingBox()
    if (!bounds) throw new Error('Missing preview bounds')
    await page.mouse.click(bounds.x + bounds.width + 8, bounds.y + bounds.height / 2)
    await expect(popup).toBeHidden()
    await page.keyboard.insertText('右')
    await drawing.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.insertText('左')
    await expect(page.locator('.mu-editor .mu-paragraph')).toHaveText('左右')
    expect(await saveDialogs.jsonValue()).toEqual([])
  } finally {
    await app.close()
  }
})

test('the slash menu inserts an embedded drawing at the paragraph in a quote', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Before\n\n> Quote\n\nAfter\n', {
    preferences: { language: 'en', embedDrawings: true, autoSave: false }
  })
  try {
    await page.locator('.mu-editor blockquote .mu-paragraph').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/excalidraw')
    const command = page.locator('.mu-quick-insert [data-label="insert-drawing"]')
    await expect(command).toHaveClass(/active/)
    await page.keyboard.press('Enter')
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await expect(popup).toBeVisible()
    await expect(popup.getByRole('button', { name: 'Insert into Document' })).toHaveCount(0)
    await popup.locator('.el-dialog__headerbtn').click()
    await expect(popup).toBeHidden()
    const drawing = page.locator('.mu-editor blockquote .mu-inline-drawing')
    await expect(drawing.getByRole('img', { name: 'Embedded drawing' })).toBeVisible()
    await expect.poll(async() => (await readFile(filePath, 'utf8')).replace(/\r\n/g, '\n'))
      .toMatch(/^Before\n\n> Quote\n>[^\n]*\n> !\[Embedded drawing\]\(data:application\/x-excalidraw;base64,[\w+/=]+\)\n\nAfter\n?$/)
  } finally {
    await app.close()
  }
})

test('the slash menu creates a sibling drawing in a tab when embedding is disabled', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Draw here', { preferences: { language: 'en' } })
  try {
    const opened = app.waitForEvent('window')
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::open-setting-window'))
    const settings = await opened
    await settings.locator('.pref-sidebar input').fill('embedDrawings')
    await settings.locator('.pref-autocomplete li').first().click()
    const embed = settings.getByRole('switch', { name: 'Embed drawings in Markdown' })
    await expect(embed).toBeChecked()
    await settings.locator('#setting-embedDrawings .el-switch').click()
    await expect(embed).not.toBeChecked()
    await expect.poll(() => page.evaluate(async() => {
      const preferences = await window.electron.ipcRenderer.invoke('mt::preferences::get')
      return preferences.embedDrawings
    })).toBe(false)
    const view = settings.locator('#setting-newDrawingView')
    await expect(view).toContainText('Floating editor')
    await view.locator('.el-select__wrapper').click()
    await settings.getByRole('option', { name: 'New tab', exact: true }).click()
    await expect.poll(() => page.evaluate(async() => {
      const preferences = await window.electron.ipcRenderer.invoke('mt::preferences::get')
      return preferences.newDrawingView
    })).toBe('tab')
    const nativeSettings = await app.browserWindow(settings)
    await nativeSettings.evaluate(window => window.close())
    const paragraph = page.locator('.mu-editor .mu-paragraph').first()
    await paragraph.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/excalidraw')
    const filename = 'Untitled Drawing.excalidraw'
    const occupiedPath = join(dirname(filePath), filename)
    await writeFile(occupiedPath, 'existing drawing')
    await page.locator('.mu-quick-insert [data-label="insert-drawing"]').click()
    await expect(page.locator('.editor-tabs li.active')).toHaveText('Untitled Drawing 2.excalidraw')
    await expect(page.getByRole('button', { name: 'Insert into Document' })).toHaveCount(0)
    await expect.poll(async() => readFile(filePath, 'utf8')).toMatch(/Draw here\s+!\[.*\]\(Untitled%20Drawing%202\.excalidraw\)/)
    expect(await readFile(occupiedPath, 'utf8')).toBe('existing drawing')
    expect(JSON.parse(await readFile(join(dirname(filePath), 'Untitled Drawing 2.excalidraw'), 'utf8'))).toMatchObject({ type: 'excalidraw', elements: [] })
  } finally {
    await app.close()
  }
})

test('flushes the clicked nested drawing on a native window close with identical scenes', async() => {
  const fence = `\`\`\`excalidraw\n${blankDrawing}\n\`\`\``
  const quote = fence.split('\n').map(line => `> ${line}`).join('\n')
  const { app, page, filePath } = await launchWithMarkdown(`${fence}\n\n${quote}\n`, {
    preferences: { language: 'en', autoSave: false }
  })
  try {
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [path] })
    }, filePath)
    const previews = page.getByRole('img', { name: 'Embedded drawing' })
    await expect(previews).toHaveCount(2)
    await previews.nth(1).click()
    const popup = page.getByRole('dialog', { name: 'Embedded drawing' })
    await popup.getByRole('button', { name: 'Add Document' }).click()
    await popup.getByRole('button', { name: 'Browse Files…' }).click()
    await popup.getByRole('button', { name: 'Add Card', exact: true }).click()
    const native = await app.browserWindow(page)
    const closed = page.waitForEvent('close')
    await native.evaluate(window => window.close())
    await closed
    const markdown = (await readFile(filePath, 'utf8')).replace(/\r\n/g, '\n')
    expect(markdown).toContain(fence)
    const nested = /^> ```excalidraw\n([\s\S]*?)\n> ```$/m.exec(markdown)?.[1]
    expect(nested && JSON.parse(nested.replace(/^> /gm, '')).elements).toMatchObject([{ type: 'image' }])
  } finally {
    await app.close()
  }
})
