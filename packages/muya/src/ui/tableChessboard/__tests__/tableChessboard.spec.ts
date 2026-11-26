// @vitest-environment happy-dom
import type { Muya } from '../../../muya';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TableChessboard from '..';
import EventCenter from '../../../event';

// The `TableChessboard` (table grid dimension picker) is a real, working
// muyajs feature whose trigger was dropped in the @muyajs/core TS rewrite and
// then wrongly deleted in #4435. These tests pin its restoration: it is
// exported from the package entrypoint, registers under a stable plugin name,
// and — crucially — subscribes to the `muya-table-picker` event so the
// in-editor "table" insert (which now dispatches it via `showTablePicker`)
// shows a hover grid and reports the picked `(row, column)` through the
// dispatched callback.
//
// We mock the slice of Muya the picker touches (eventCenter, domNode, i18n,
// ui) and run BaseFloat for real so the snabbdom render path is exercised
// end-to-end in happy-dom.

// Nodes appended straight to `document.body` by the fakes below. Tracked so
// `afterEach` can detach them — BaseFloat.destroy() only removes its own
// floatBox, not these host/reference nodes.
const appendedNodes: Node[] = [];

function track<T extends Node>(node: T): T {
    appendedNodes.push(node);
    return node;
}

function makeFakeMuya(): { muya: Muya; eventCenter: EventCenter } {
    const eventCenter = new EventCenter();
    const editorDomNode = document.createElement('div');
    const editorWrapper = document.createElement('div');
    editorWrapper.appendChild(editorDomNode);
    document.body.appendChild(track(editorWrapper));

    const shownFloat = new Set();
    // Mirror Ui.listen so `status` flips when the float shows/hides.
    eventCenter.subscribe('muya-float', (tool: unknown, status: boolean) => {
        status ? shownFloat.add(tool) : shownFloat.delete(tool);
    });

    const muya = {
        domNode: editorDomNode,
        eventCenter,
        i18n: { t: (s: string) => s },
        ui: { shownFloat },
        options: {},
    } as unknown as Muya;

    return { muya, eventCenter };
}

function stubReference(): HTMLElement {
    const input = document.createElement('input');
    // BaseFloat computes position off the reference; happy-dom has no layout,
    // so a stubbed rect keeps autoUpdate from throwing.
    input.getBoundingClientRect = () =>
        ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => '' }) as DOMRect;
    document.body.appendChild(track(input));
    return input;
}

async function nextTick() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

describe('tableChessboard — plugin shape (restored, revert #4435)', () => {
    // The package entrypoint pulls in mermaid/vega/katex; the full 374-worker
    // suite can push this single import past the 5s default (passes in isolation).
    it('is exported from the package entrypoint', async () => {
        const pkg = await import('../../../index');
        expect('TableChessboard' in pkg).toBe(true);
        expect(pkg.TableChessboard).toBe(TableChessboard);
    }, 15000);

    it('exposes a stable static pluginName so Muya.use registers it', () => {
        expect(TableChessboard.pluginName).toBe('tablePicker');
    });
});

describe('tableChessboard — muya-table-picker subscription + grid pick', () => {
    let muya: Muya;
    let eventCenter: EventCenter;
    let picker: TableChessboard;

    beforeEach(() => {
        ({ muya, eventCenter } = makeFakeMuya());
        picker = new TableChessboard(muya);
    });

    afterEach(() => {
        // BaseFloat appends a floatBox to <body>, runs floating-ui autoUpdate,
        // and observes its container with a ResizeObserver — tear all of that
        // down so listeners/observers/nodes don't leak across specs.
        picker.destroy();
        // Detach the host/reference nodes the fakes appended to <body>.
        for (const node of appendedNodes.splice(0))
            (node as ChildNode).remove?.();
        vi.restoreAllMocks();
    });

    it('subscribes to `muya-table-picker` on construction', () => {
        expect(eventCenter.listeners['muya-table-picker']).toBeDefined();
        expect(eventCenter.listeners['muya-table-picker'].length).toBeGreaterThan(0);
    });

    it('shows the grid and renders selectable cells when the event is dispatched', async () => {
        const reference = stubReference();
        eventCenter.emit('muya-table-picker', { row: -1, column: -1 }, reference, () => {});
        await nextTick();

        expect(picker.status).toBe(true);
        const cells = picker.floatBox!.querySelectorAll('span.mu-table-picker-cell');
        // Default checker grid is 6 rows × 8 columns.
        expect(cells.length).toBe(6 * 8);
        // The footer row/column inputs and the OK button are present.
        expect(picker.floatBox!.querySelector('input.row-input')).not.toBeNull();
        expect(picker.floatBox!.querySelector('input.column-input')).not.toBeNull();
        expect(picker.floatBox!.querySelector('.footer button')).not.toBeNull();
    });

    it('invokes the dispatched callback with the hovered `(row, column)` on cell click and hides', async () => {
        const reference = stubReference();
        const cb = vi.fn();
        eventCenter.emit('muya-table-picker', { row: -1, column: -1 }, reference, cb);
        await nextTick();

        const selector = 'span.mu-table-picker-cell[data-row="2"][data-column="3"]';
        const cell = picker.floatBox!.querySelector(selector) as HTMLElement;
        cell.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        cell.click();

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(2, 3);
        // Picking dismisses the float.
        expect(picker.status).toBe(false);
    });

    it('continues from the hovered cell or typed size when navigating with the keyboard', () => {
        const cb = vi.fn();
        eventCenter.emit('muya-table-picker', { row: -1, column: -1 }, stubReference(), cb);
        const row = picker.container!.querySelector<HTMLInputElement>('.row-input')!;
        const column = picker.container!.querySelector<HTMLInputElement>('.column-input')!;
        const cell = picker.container!.querySelector('[data-row="2"][data-column="3"]')!;
        cell.dispatchEvent(new MouseEvent('mouseenter'));
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(row.value).toBe('3');
        expect(column.value).toBe('3');

        row.value = '1';
        row.dispatchEvent(new Event('input', { bubbles: true }));
        expect(row.value).toBe('1');
        row.value += '2';
        row.dispatchEvent(new Event('input', { bubbles: true }));
        row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(row.value).toBe('12');
        expect(column.value).toBe('4');
        row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(cb).toHaveBeenCalledExactlyOnceWith(11, 3);
        expect(picker.status).toBe(false);
    });

    it('caps arrow-key navigation at the chessboard size limit', () => {
        const cb = vi.fn();
        eventCenter.emit('muya-table-picker', { row: -1, column: -1 }, stubReference(), cb);
        const row = picker.container!.querySelector<HTMLInputElement>('.row-input')!;
        row.value = '50';
        row.dispatchEvent(new Event('input', { bubbles: true }));

        for (let i = 0; i < 10; i++)
            muya.domNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(cb).toHaveBeenCalledExactlyOnceWith(49, 0);
        expect(picker.status).toBe(false);
    });

    it('toggles closed when the event is re-dispatched while already shown', async () => {
        const reference = stubReference();
        eventCenter.emit('muya-table-picker', { row: -1, column: -1 }, reference, () => {});
        await nextTick();
        expect(picker.status).toBe(true);

        // A second dispatch while open hides it (legacy toggle behaviour).
        eventCenter.emit('muya-table-picker', { row: -1, column: -1 }, reference, () => {});
        await nextTick();
        expect(picker.status).toBe(false);
    });
});
