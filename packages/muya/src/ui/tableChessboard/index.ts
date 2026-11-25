import type { ReferenceElement } from '@floating-ui/dom';
import type { VNode } from 'snabbdom';
import type { Muya } from '../../index';
import { EVENT_KEYS } from '../../config';
import { isHTMLInputElement, isKeyboardEvent } from '../../utils';
import { h, patch } from '../../utils/snabbdom';

import BaseFloat from '../baseFloat';

import './index.css';

interface ICheckerCount {
    row: number;
    column: number;
}

// Zero-based bottom-right cell of the initial two-row, one-column table.
const DEFAULT_SELECTION = { row: 1, column: 0 };
// Upper bound for the row/column inputs (inclusive); keeps a mistyped huge
// number from creating an editor-freezing table.
const MAX_CHESSBOARD_SIZE = 50;
const ARROW_STEPS = new Map<string, ICheckerCount>([
    [EVENT_KEYS.ArrowRight, { row: 0, column: 1 }],
    [EVENT_KEYS.ArrowLeft, { row: 0, column: -1 }],
    [EVENT_KEYS.ArrowDown, { row: 1, column: 0 }],
    [EVENT_KEYS.ArrowUp, { row: -1, column: 0 }],
]);

function tableSelection(row: number, column: number): ICheckerCount {
    return { row: Math.max(row, 0), column: Math.max(column, 0) };
}

class TablePicker extends BaseFloat {
    static pluginName = 'tablePicker';
    public override capturesContentKeydown = true;

    private _checkerCount: ICheckerCount;
    private _oldVNode: VNode | null;
    private _current: ICheckerCount | null;
    private _select = { ...DEFAULT_SELECTION };
    private _tableContainer: HTMLElement;

    constructor(muya: Muya) {
        const name = 'mu-table-picker';
        super(muya, name);
        this._checkerCount = {
            row: 6,
            column: 8,
        };
        this._oldVNode = null;
        this._current = null;
        const tableContainer = (this._tableContainer
            = document.createElement('div'));
        this.container!.appendChild(tableContainer);
        this.listen();
    }

    override listen() {
        const { eventCenter, domNode } = this.muya;
        super.listen();
        // Capture before the slash menu handles Enter, so opening the picker cannot also confirm it.
        const keydown = this._keydownHandler.bind(this);
        eventCenter.attachDOMEvent(domNode, 'keydown', keydown, true);
        eventCenter.attachDOMEvent(this.container!, 'keydown', keydown);
        eventCenter.attachDOMEvent(this.container!, 'mousedown', (event) => {
            if (event.target instanceof Element && event.target.closest('.mu-table-picker-cell'))
                event.preventDefault();
        });
        eventCenter.subscribe('muya-table-picker', (data, reference, cb) => {
            if (!this.status) {
                this._showPicker(data, reference, cb);
                this.render();
            }
            else {
                this.hide();
            }
        });
    }

    render(input: { row?: string; column?: string } = {}) {
        const { row, column } = this._checkerCount;
        const { row: cRow, column: cColumn } = this._current!;
        const { row: sRow, column: sColumn } = this._select;
        const { _tableContainer: tableContainer, _oldVNode: oldVNode } = this;
        const tableRows = [];
        for (let i = 0; i < row; i++) {
            let rowSelector = 'div.mu-table-picker-row';
            if (i === 0)
                rowSelector += '.mu-table-picker-header';

            const cells = [];

            for (let j = 0; j < column; j++) {
                cells.push(
                    h('span.mu-table-picker-cell', {
                        key: j.toString(),
                        class: {
                            current: i <= cRow && j <= cColumn,
                            selected: i <= sRow && j <= sColumn,
                        },
                        dataset: {
                            row: i.toString(),
                            column: j.toString(),
                        },
                        on: {
                            mouseenter: () => {
                                this._select = tableSelection(i, j);
                                this.render();
                            },
                            click: () => {
                                this._select = tableSelection(i, j);
                                this.selectItem();
                            },
                        },
                    }),
                );
            }

            tableRows.push(h(rowSelector, cells));
        }

        const tableFooter = h('div.footer', [
            h('input.row-input', {
                props: {
                    type: 'text',
                    value: input.row ?? String(sRow + 1),
                },
                on: {
                    input: (event: Event) => {
                        this._inputHandler(event, 'row');
                    },
                },
            }),
            'x',
            h('input.column-input', {
                props: {
                    type: 'text',
                    value: input.column ?? String(sColumn + 1),
                },
                on: {
                    input: (event: Event) => {
                        this._inputHandler(event, 'column');
                    },
                },
            }),
            h(
                'button',
                {
                    on: {
                        click: (_) => {
                            this.selectItem();
                        },
                    },
                },
                'OK',
            ),
        ]);

        const vnode = h('div', [h('div.checker', tableRows), tableFooter]);

        if (oldVNode)
            patch(oldVNode, vnode);
        else
            patch(tableContainer, vnode);

        this._oldVNode = vnode;
    }

    private _keydownHandler(event: Event) {
        if (!this.status || !isKeyboardEvent(event) || event.isComposing
            || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
            return;
        }

        const step = ARROW_STEPS.get(event.key);
        if (!step && event.key !== EVENT_KEYS.Enter)
            return;

        event.preventDefault();
        event.stopImmediatePropagation();
        if (step) {
            const { row, column } = this._select;
            // Arrow keys must respect the same cap as the numeric input, or
            // holding a key would build a grid that bypasses the freeze guard.
            this._select = tableSelection(
                Math.min(row + step.row, MAX_CHESSBOARD_SIZE - 1),
                Math.min(column + step.column, MAX_CHESSBOARD_SIZE - 1),
            );
            this.render();
        }
        else {
            this.selectItem();
        }
    }

    private _inputHandler(event: Event, type: keyof ICheckerCount) {
        if (!isHTMLInputElement(event.target))
            return;
        const { value } = event.target;
        const count = Number(value);
        if (Number.isSafeInteger(count)) {
            // Cap the grid: an unbounded input (e.g. 100000) would create a
            // table that freezes the editor and the OT layer.
            this._select[type] = Math.min(Math.max(count - 1, 0), MAX_CHESSBOARD_SIZE - 1);
            // Show the effective size, not the raw input: a clamped value
            // (99999 -> 50) must not be presented as if it were honoured.
            this.render({ [type]: String(this._select[type] + 1) });
            return;
        }
        // Keep partial input editable, e.g. the first digit of a 12-row table.
        this.render({ [type]: value });
    }

    private _showPicker(current: ICheckerCount, reference: ReferenceElement, cb: (row: number, column: number) => void) {
        this._current = current;
        this._select = current.row < 0 && current.column < 0
            ? { ...DEFAULT_SELECTION }
            : tableSelection(current.row, current.column);
        super.show(reference, cb);
    }

    selectItem() {
        const { cb } = this;
        const { row, column } = this._select;
        cb(row, column);
        this.hide();
    }
}

export default TablePicker;
