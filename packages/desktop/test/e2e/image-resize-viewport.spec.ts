import { expect, test } from '@playwright/test'
import { launchWithMarkdown } from './helpers'

test('keeps image resize handles visible while scrolling a hovered image under the title bar', async() => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280"><rect width="100%" height="100%" fill="teal"/></svg>'
  const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  const { app, page } = await launchWithMarkdown(`![Picture](${data})\n\nAfter the picture.`, {
    preferences: { titleBarStyle: 'custom', compactMode: false }
  })
  try {
    const image = page.locator('.editor-component .mu-embedded-picture img')
    await expect(image).toHaveJSProperty('naturalHeight', 280)
    const editor = page.locator('.editor-component')
    await editor.evaluate(viewport => new Promise<void>(resolve => {
      viewport.addEventListener('scroll', () => resolve(), { once: true })
      viewport.scrollTop += 1
    }))
    const fullImage = await image.boundingBox()
    const editorBox = await editor.boundingBox()
    if (!fullImage || !editorBox) throw new Error('Missing image or editor bounds')
    const editorTop = editorBox.y
    const pointerX = fullImage.x + fullImage.width / 2
    const pointerY = fullImage.y + 16
    const handles = page.locator('.mu-transformer .bar')
    await page.mouse.move(pointerX, pointerY)
    await expect(handles).toHaveCount(2)

    await editor.evaluate((viewport, offset) => new Promise<void>(resolve => {
      viewport.addEventListener('scroll', () => resolve(), { once: true })
      viewport.scrollTop += offset
    }), fullImage.y - editorTop + fullImage.height / 2 - 8)
    await page.mouse.move(pointerX, pointerY + 1)
    const imageBox = await image.boundingBox()
    if (!imageBox) throw new Error('Missing clipped image bounds')
    const imageBottom = imageBox.y + imageBox.height
    expect(imageBox.y).toBeLessThan(editorTop)
    expect(pointerY + 1).toBeLessThan(imageBottom)

    await expect(handles).toHaveCount(2)
    for (const handle of await handles.all()) {
      await expect(handle).toBeVisible()
      const box = await handle.boundingBox()
      if (!box) throw new Error('Missing resize handle bounds')
      expect(box.y).toBeGreaterThanOrEqual(editorTop)
      expect(box.y + box.height).toBeLessThanOrEqual(imageBottom)
    }

    await page.locator('.mu-transformer .right').hover()
    await page.mouse.down()
    await expect(page.locator('.mu-image-size-readout')).toBeVisible()
    await page.mouse.up()
  } finally {
    await app.close()
  }
})
