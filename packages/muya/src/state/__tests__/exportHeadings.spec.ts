// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { EXPORT_DOMPURIFY_CONFIG } from '../../config';
import { Muya } from '../../muya';
import { sanitize } from '../../utils';
import { getMarkdownOutline } from '../markdownOutline';
import { MarkdownToHtml } from '../markdownToHtml';

describe('export heading metadata', () => {
    it('reports the final IDs, levels and inline content from the rendered document', async () => {
        const markdown = [
            '<h2 id="intro">Reserved</h2>',
            '',
            '> ## Intro',
            '',
            '## Intro',
            '',
            '### Use **bold** and [a link](https://example.com)',
        ].join('\n');
        const { html, headings } = await new MarkdownToHtml(markdown).generateWithHeadings();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rendered = [...doc.querySelectorAll('article h2, article h3')];

        expect(headings.map(heading => heading.slug)).toEqual([
            'intro',
            'intro-1',
            'intro-2',
            'use-bold-and-a-link',
        ]);
        expect(headings).toEqual(rendered.map(heading => ({
            lvl: Number(heading.tagName.slice(1)),
            content: heading.textContent,
            contentHtml: heading.innerHTML,
            slug: heading.id,
        })));
        expect(document.querySelector('.mu-render-container')).toBeNull();
    });

    it('retains formula source after MathML is stripped, without changing its rendered content', async () => {
        const { html, headings } = await new MarkdownToHtml('## $x < y$').generateWithHeadings();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const math = doc.querySelector('h2 .katex');

        expect(math?.getAttribute('aria-label')).toBe('x < y');
        expect(math?.querySelector('.katex-html')).not.toBeNull();
        expect(math?.querySelector('math, annotation')).toBeNull();
        const labelDoc = new DOMParser().parseFromString(headings[0].contentHtml, 'text/html');
        expect(labelDoc.querySelector('.katex')?.getAttribute('aria-label')).toBe('x < y');
        expect(headings[0].slug).toBe(doc.querySelector('h2')?.id);

        const raw = '<span class="katex"><math><semantics><annotation encoding="application/x-tex">x</annotation></semantics></math></span>';
        expect(sanitize(raw, EXPORT_DOMPURIFY_CONFIG, false)).not.toContain('aria-label');
    });

    it('does not retain headings between renders of the same exporter', async () => {
        const exporter = new MarkdownToHtml('## Old');
        await exporter.generateWithHeadings();
        exporter.markdown = '## New';

        const { html, headings } = await exporter.generateWithHeadings();

        expect(headings.map(heading => heading.slug)).toEqual(['new']);
        expect(html).toContain('<h2 id="new">New</h2>');
        expect(html).not.toContain('<h2 id="old">');
    });

    it('gives outline anchors the same IDs as HTML after nested and explicit headings', async () => {
        const markdown = '> ## Duplicate\n\n- ## Duplicate\n\n## Duplicate\n\n<h2 id="duplicate">Reserved</h2>\n';
        const host = document.body.appendChild(document.createElement('div'));
        const muya = new Muya(host, { markdown });
        try {
            muya.init({ focus: false });
            const live = muya.getTOC();
            const source = getMarkdownOutline(markdown).headings;
            const { headings } = await new MarkdownToHtml(markdown, muya).renderHtmlWithHeadings();

            expect(headings.map(heading => heading.slug)).toEqual(['duplicate-1', 'duplicate-2', 'duplicate-3', 'duplicate']);
            expect(live.map(heading => heading.anchor)).toEqual(['duplicate-3']);
            expect(source.map(heading => heading.anchor)).toEqual(['duplicate-3']);
        }
        finally {
            muya.destroy();
            muya.domNode.remove();
        }
    });
});
