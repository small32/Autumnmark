// @vitest-environment happy-dom

import type { Muya } from '../../../muya';
import type Content from '../../base/content';
import type TreeNode from '../../base/treeNode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScrollPage } from '..';
import { Muya as Editor } from '../../../muya';

const editors: Muya[] = [];

function boot(markdown: string, readOnly = false): Muya {
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Editor(host, { markdown, readOnly });
    muya.init({ focus: false });
    editors.push(muya);
    return muya;
}

afterEach(() => {
    for (const muya of editors.splice(0)) {
        muya.destroy();
        muya.domNode.remove();
    }
    vi.restoreAllMocks();
});

function contentBlocks(muya: Muya): Content[] {
    const blocks: Content[] = [];
    muya.editor.scrollPage!.depthFirstTraverse((node: TreeNode) => {
        if (node.isContent())
            blocks.push(node as Content);
    });
    return blocks;
}

describe('scrollPage.updateState rebuild', () => {
    it('creates the next tree before swapping, and drops stray container nodes', () => {
        const muya = boot('alpha\n\nbeta\n');
        const page = muya.editor.scrollPage!;
        const container = page.domNode!;
        const stray = document.createElement('span');
        stray.dataset.stray = 'yes';
        container.append(stray);
        const Paragraph = ScrollPage.loadBlock('paragraph');
        const create = Paragraph.create;
        const duringCreate: number[] = [];
        vi.spyOn(Paragraph, 'create').mockImplementation((...args) => {
            duringCreate.push(container.childElementCount);
            return create(...args as Parameters<typeof create>);
        });

        page.updateState(muya.getState());

        expect(duringCreate.length).toBeGreaterThan(0);
        expect(duringCreate.every(count => count > 0)).toBe(true);
        expect(container.querySelector('[data-stray]')).toBeNull();
        expect([...container.children].map(node => node.className)).toEqual(['mu-paragraph', 'mu-paragraph']);
    });

    it('does not repaint the mounted reference tree while rebuilding, and still refreshes after a mounted edit', () => {
        const muya = boot('[ref]: https://example.com\n\nsee [ref]\n\nsee [ref] again\n');
        const page = muya.editor.scrollPage!;
        const oldBlocks = contentBlocks(muya);
        const updates = oldBlocks.map(block => vi.spyOn(block, 'update'));
        muya.domNode.style.overflow = 'auto';
        muya.domNode.style.height = '40px';
        muya.domNode.scrollTop = 120;

        page.updateState(muya.getState());

        expect(updates.every(spy => spy.mock.calls.length === 0)).toBe(true);
        expect(muya.domNode.scrollTop).toBe(120);
        const mounted = contentBlocks(muya);
        const definition = mounted.find(block => block.text.startsWith('[ref]:'));
        const usage = mounted.find(block => block.text === 'see [ref]');
        if (!definition || !usage)
            throw new Error('Expected a definition and a reference');
        const usageUpdate = vi.spyOn(usage, 'update');
        definition.text = '[ref]: https://example.com/edited';
        definition.update();
        expect(usageUpdate).toHaveBeenCalled();
        expect(muya.domNode.scrollTop).toBe(120);
    });

    it('clears detached fold parents and lets the host restore them', () => {
        const markdown = '# A\n\nalpha\n\n# B\n';
        const muya = boot(markdown);
        muya.domNode.querySelectorAll('.mu-fold-toggle')[0]
            .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        const folds = muya.getHeadingFoldState();
        expect(folds.length).toBeGreaterThan(0);
        expect(muya.domNode.querySelectorAll('.mu-folded-content').length).toBeGreaterThan(0);

        muya.editor.scrollPage!.updateState(muya.getState());

        expect(muya.getHeadingFoldState()).toEqual([]);
        expect(muya.domNode.querySelectorAll('.mu-folded-content')).toHaveLength(0);
        muya.setHeadingFoldState(folds);
        expect(muya.getHeadingFoldState()).toEqual(folds);
        expect(muya.domNode.querySelectorAll('.mu-folded-content').length).toBeGreaterThan(0);
    });

    it('clears the container when the next state is empty', () => {
        const muya = boot('alpha\n\nbeta\n');
        const container = muya.editor.scrollPage!.domNode!;
        muya.editor.scrollPage!.updateState([]);
        expect(container.childElementCount).toBe(0);
    });

    it('still rebuilds a read-only document from the host', () => {
        const muya = boot('old', true);
        expect(muya.replaceContent('new')).toBe(true);
        expect(muya.getMarkdown()).toContain('new');
        expect(muya.domNode.querySelector('[contenteditable="true"]')).toBeNull();
    });
});
