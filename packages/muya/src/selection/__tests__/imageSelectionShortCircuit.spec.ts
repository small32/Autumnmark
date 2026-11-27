// @vitest-environment happy-dom

import type Format from '../../block/base/format';
import type Table from '../../block/gfm/table';
import type { INodeOffset } from '../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';
import { getImageInfo } from '../../utils/image';
import { SelectionType } from '../types';

const bootedMuyas: Muya[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedMuyas.length)
        bootedMuyas.pop()!.destroy();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
    vi.restoreAllMocks();
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init({ focus: false });
    bootedMuyas.push(muya);
    return muya;
}

function textAnchor(muya: Muya): { anchor: INodeOffset | null } {
    return (muya.editor.selection as unknown as { _text: { anchor: INodeOffset | null } })._text;
}

describe('getImageSelection short-circuit', () => {
    it.each(['null', 'text', 'table'] as const)('returns null for a %s selection without reading the native selection', (kind) => {
        const markdown = kind === 'table'
            ? '| a | b |\n| --- | --- |\n| c | d |\n'
            : 'hello world\n';
        const muya = bootMuya(markdown);
        const { selection } = muya.editor;
        if (kind === 'text') {
            const first = muya.editor.scrollPage!.firstContentInDescendant()!;
            selection.setSelection({
                kind: SelectionType.TEXT,
                anchor: { path: first.path, offset: 1 },
                focus: { path: first.path, offset: 4 },
            });
        }
        else if (kind === 'table') {
            const table = muya.editor.scrollPage!.firstContentInDescendant()!.closestBlock('table');
            if (table?.blockName !== 'table')
                throw new Error('Expected a table');
            selection.table.selectTable(table as Table);
        }
        else {
            selection.clear();
        }

        const anchor = textAnchor(muya);
        const sentinel: INodeOffset = { offset: 7 };
        anchor.anchor = sentinel;
        const getSelection = vi.spyOn(document, 'getSelection');
        expect(selection.getImageSelection()).toBeNull();
        expect(selection.image).toBeNull();
        expect(getSelection).not.toHaveBeenCalled();
        expect(anchor.anchor).toBe(sentinel);
    });

    it('resolves an image from an independent state copy', () => {
        const muya = bootMuya('![alt](image.png)\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()! as Format;
        const wrapper = first.domNode!.querySelector<HTMLElement>('.mu-inline-image')!;
        muya.editor.selection.selectImage({
            ...getImageInfo(wrapper),
            block: first,
        });
        const stored = (muya.editor.selection as unknown as { _state: { path: readonly (string | number)[] } | null })._state;
        const resolved = muya.editor.selection.getImageSelection();
        expect(resolved?.kind).toBe(SelectionType.IMAGE);
        expect(stored?.path).toBeDefined();
        expect(resolved!.path).not.toBe(stored!.path);
        const original = [...stored!.path];
        (resolved!.path as (string | number)[]).push(9);
        expect([...stored!.path]).toEqual(original);
    });

    it('returns null when the stored image no longer matches the block text', () => {
        const muya = bootMuya('![alt](image.png)\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()! as Format;
        const wrapper = first.domNode!.querySelector<HTMLElement>('.mu-inline-image')!;
        muya.editor.selection.selectImage({
            ...getImageInfo(wrapper),
            block: first,
        });
        first.text = 'plain';
        const getSelection = vi.spyOn(document, 'getSelection');
        expect(muya.editor.selection.type).toBe(SelectionType.IMAGE);
        expect(muya.editor.selection.getImageSelection()).toBeNull();
        expect(getSelection).not.toHaveBeenCalled();
    });
});
