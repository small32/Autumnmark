import { expect, test } from '@playwright/test'
import { blankDrawing } from '../../src/shared/drawing'
import { getMarkdownContent, launchWithMarkdown } from './helpers'

const pictureSource = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="120"><rect width="100%" height="100%" fill="navy"/></svg>'
).toString('base64')
const drawingSource = 'data:application/x-excalidraw;base64,' + Buffer.from(blankDrawing).toString('base64')

const media = [
  { label: 'picture', selector: '.mu-embedded-picture', markdown: `![Picture](${pictureSource})` },
  { label: 'drawing', selector: '.mu-inline-drawing', markdown: `![Drawing](${drawingSource})` }
]
const alignments = ['top', 'middle', 'bottom'] as const

for (const { label, selector, markdown } of media) {
  test(`keeps the caret at the first character's height on both sides of a ${label}`, async() => {
    const { app, page } = await launchWithMarkdown(alignments.map(() => markdown).join('\n\n'), {
      preferences: { language: 'en', autoSave: false }
    })
    try {
      const atoms = page.locator('.mu-editor ' + selector)
      await expect(atoms.locator('img')).toHaveCount(alignments.length)
      const documentLines: string[] = []
      for (const [index, alignment] of alignments.entries()) {
        if (alignment !== 'top') {
          await page.addStyleTag({
            content: `.mu-editor .mu-paragraph:nth-child(${index + 1}) ${selector} { vertical-align: ${alignment}; }`
          })
        }
        const atom = atoms.nth(index)
        await expect(atom).toHaveCSS('vertical-align', alignment)
        const paragraph = atom.locator('xpath=ancestor::*[contains(@class, "mu-paragraph-content")]')

        for (const [side, letter] of [['start', 'L'], ['end', 'R']] as const) {
          await atom.evaluate((element, edge) => {
            const editor = element.closest<HTMLElement>('.mu-editor')
            const selection = document.getSelection()
            if (!editor || !selection) throw new Error('Missing editor selection')
            const range = document.createRange()
            if (edge === 'start') range.setStartBefore(element)
            else range.setStartAfter(element)
            range.collapse(true)
            editor.focus()
            selection.removeAllRanges()
            selection.addRange(range)
          }, side)

          const caret = paragraph.locator(`[data-mu-image-caret="${side}"]`)
          await expect(caret).toHaveCount(1)
          const before = await caret.evaluate(element => {
            const style = getComputedStyle(element, '::after')
            const rect = element.getBoundingClientRect()
            return { top: rect.top + Number.parseFloat(style.top), height: Number.parseFloat(style.height) }
          })
          expect(before.height).toBeGreaterThan(10)
          const bounds = await atom.boundingBox()
          if (!bounds) throw new Error('Missing media bounds')
          const relativeHeight = (before.top + before.height / 2 - bounds.y) / bounds.height
          if (alignment === 'top') expect(relativeHeight).toBeLessThan(0.25)
          if (alignment === 'middle') expect(relativeHeight).toBeCloseTo(0.5, 1)
          if (alignment === 'bottom') expect(relativeHeight).toBeGreaterThan(0.75)

          await page.keyboard.type(letter)
          await expect(paragraph).toContainText(letter)
          const insertedTop = await paragraph.evaluate((element, text) => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              if (node.textContent === text) {
                const range = document.createRange()
                range.selectNodeContents(node)
                return range.getBoundingClientRect().top
              }
            }
            throw new Error('Missing inserted text')
          }, letter)
          expect(Math.abs(before.top - insertedTop)).toBeLessThan(2)
        }
        documentLines.push(`L${markdown}R`)
      }
      expect((await getMarkdownContent(page, app)).trim()).toBe(documentLines.join('\n\n'))
    } finally {
      await app.close()
    }
  })
}
