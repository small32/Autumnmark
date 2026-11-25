import type Content from '../block/base/content';
import type { ScrollPage } from '../block/scrollPage';
import type { TState } from '../state/types';
import type { ITextSelectionState } from './types';
import { contentPath } from './state';
import { SelectionType } from './types';

// Zero-based source-mode line and character coordinates.
export interface IIndexPosition {
    line: number;
    ch: number;
}

export interface IIndexCursor {
    anchor: IIndexPosition | null;
    focus: IIndexPosition | null;
}

// ASCII markers must survive Markdown parsing as literal text. The random
// token keeps them unique per injection: a document that happens to contain
// the marker prefix can no longer shadow the injected marker.
const SENTINEL_PREFIX = 'mUyAcUrSoRzZq';
const SENTINEL_TOKEN_LENGTH = 8;
const SENTINEL_PATTERN = /mUyAcUrSoRzZq([a-z0-9]{8})(?:AnChOr|FoCuS)/;

function _createToken(): string {
    let token = '';

    for (let i = 0; i < SENTINEL_TOKEN_LENGTH; i++)
        token += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)];

    return token;
}

function _anchorSentinel(token: string): string {
    return `${SENTINEL_PREFIX}${token}AnChOr`;
}

function _focusSentinel(token: string): string {
    return `${SENTINEL_PREFIX}${token}FoCuS`;
}

// Detect the token of an injected marker pair so the exact markers can be
// located; user text that merely contains the prefix is ignored.
function _detectToken(text: string): { anchor: string; focus: string } | null {
    const match = SENTINEL_PATTERN.exec(text);

    if (!match)
        return null;

    const token = match[1];

    return { anchor: _anchorSentinel(token), focus: _focusSentinel(token) };
}

function _clampOffset(offset: number, length: number): number {
    if (!Number.isInteger(offset))
        return 0;

    return Math.min(Math.max(offset, 0), length);
}

// Return null when either source line no longer exists.
export function injectSentinels(
    markdown: string,
    cursor: IIndexCursor,
): string | null {
    const { anchor, focus } = cursor;
    if (!anchor || !focus)
        return null;

    const lines = markdown.split('\n');
    const isValidLine = (line: number): boolean =>
        Number.isInteger(line) && line >= 0 && line < lines.length;

    if (!isValidLine(anchor.line) || !isValidLine(focus.line))
        return null;

    const anchorText = lines[anchor.line]!;
    const focusText = lines[focus.line]!;
    const anchorCh = _clampOffset(anchor.ch, anchorText.length);
    const focusCh = _clampOffset(focus.ch, focusText.length);
    const token = _createToken();
    const anchorSentinel = _anchorSentinel(token);
    const focusSentinel = _focusSentinel(token);

    if (anchor.line === focus.line) {
        const min = Math.min(anchorCh, focusCh);
        const max = Math.max(anchorCh, focusCh);
        const first = anchorText.substring(0, min);
        const middle = anchorText.substring(min, max);
        const last = anchorText.substring(max);
        lines[anchor.line]
            = first
                + (anchorCh <= focusCh ? anchorSentinel : focusSentinel)
                + middle
                + (anchorCh <= focusCh ? focusSentinel : anchorSentinel)
                + last;
    }
    else {
        lines[anchor.line]
            = anchorText.substring(0, anchorCh) + anchorSentinel + anchorText.substring(anchorCh);
        lines[focus.line]
            = focusText.substring(0, focusCh) + focusSentinel + focusText.substring(focusCh);
    }

    return lines.join('\n');
}

interface ISentinelHit {
    block: Content;
    offset: number;
}

// Find a marker without mutating the transient tree; offsets exclude that marker.
function _findSentinel(scrollPage: ScrollPage, sentinel: string): ISentinelHit | null {
    let hit: ISentinelHit | null = null;

    scrollPage.depthFirstTraverse((node) => {
        if (hit || !node.isContent())
            return;

        const idx = node.text.indexOf(sentinel);
        if (idx > -1)
            hit = { block: node, offset: idx };
    });

    return hit;
}

// Return sentinel-free paths and offsets, or null when neither endpoint resolves.
// Do not retain block references: the caller replaces the transient tree immediately.
export function resolveSentinelCursor(scrollPage: ScrollPage): ITextSelectionState | null {
    // Detect the injected token first so user text that contains the marker
    // prefix cannot shadow the real markers.
    const detected: { anchor: string; focus: string }[] = [];

    scrollPage.depthFirstTraverse((node) => {
        if (detected.length || !node.isContent())
            return;

        const found = _detectToken(node.text);
        if (found)
            detected.push(found);
    });

    if (!detected.length)
        return null;

    const markers = detected[0];
    const anchorHit = _findSentinel(scrollPage, markers.anchor);
    const focusHit = _findSentinel(scrollPage, markers.focus);

    if (!anchorHit && !focusHit)
        return null;

    const anchor = anchorHit ?? focusHit!;
    const focus = focusHit ?? anchorHit!;

    let anchorOffset = anchor.offset;
    let focusOffset = focus.offset;

    // When both sentinels live in the same block, the second one's recorded
    // offset is shifted by the first sentinel's length. Normalize so both
    // offsets are expressed against the sentinel-free text.
    if (anchor.block === focus.block) {
        if (anchorOffset <= focusOffset)
            focusOffset = Math.max(focusOffset - markers.anchor.length, anchorOffset);
        else
            anchorOffset = Math.max(anchorOffset - markers.focus.length, focusOffset);
    }

    return {
        kind: SelectionType.TEXT,
        anchor: {
            offset: anchorOffset,
            path: contentPath(anchor.block),
        },
        focus: {
            offset: focusOffset,
            path: contentPath(focus.block),
        },
    };
}

// Mutate the supplied state at a text path with a clamped offset.
// Return false when the path has no string text; callers must supply a throwaway clone.
function _injectSentinelAtPath(
    state: TState[],
    path: readonly (string | number)[],
    offset: number,
    sentinel: string,
): boolean {
    if (path.length === 0)
        return false;

    let node: unknown = state;
    for (let i = 0; i < path.length - 1; i++) {
        if (node == null || typeof node !== 'object')
            return false;
        node = (node as Record<string | number, unknown>)[path[i]!];
    }

    const key = path[path.length - 1]!;
    if (node == null || typeof node !== 'object')
        return false;

    const holder = node as Record<string | number, unknown>;
    const text = holder[key];
    if (typeof text !== 'string')
        return false;

    const at = _clampOffset(offset, text.length);
    holder[key] = text.substring(0, at) + sentinel + text.substring(at);

    return true;
}

// Insert markers into the supplied cloned state at the selection endpoints.
// Return null when neither endpoint resolves to text.
export function injectStateSentinels(
    state: TState[],
    selection: ITextSelectionState,
): TState[] | null {
    const anchorPath = selection.anchor.path;
    const focusPath = selection.focus.path;
    const anchorOffset = selection.anchor.offset;
    const focusOffset = selection.focus.offset;

    const sameBlock
        = anchorPath.length === focusPath.length
            && anchorPath.every((seg, i) => seg === focusPath[i]);

    const inject = (
        path: readonly (string | number)[],
        offset: number,
        sentinel: string,
    ): boolean => _injectSentinelAtPath(state, path, offset, sentinel);

    const token = _createToken();
    const anchorSentinel = _anchorSentinel(token);
    const focusSentinel = _focusSentinel(token);

    if (!sameBlock) {
        const anchorOk = inject(anchorPath, anchorOffset, anchorSentinel);
        const focusOk = inject(focusPath, focusOffset, focusSentinel);

        return anchorOk || focusOk ? state : null;
    }

    // Same block: inject the earlier offset first (unshifted), then the later
    // one shifted by the first sentinel's length.
    let ok: boolean;
    if (anchorOffset <= focusOffset) {
        ok = inject(anchorPath, anchorOffset, anchorSentinel);
        ok = inject(focusPath, focusOffset + anchorSentinel.length, focusSentinel) || ok;
    }
    else {
        ok = inject(focusPath, focusOffset, focusSentinel);
        ok = inject(anchorPath, anchorOffset + focusSentinel.length, anchorSentinel) || ok;
    }

    return ok ? state : null;
}

// Scan without allocating a line array for large documents.
function _lineColAt(markdown: string, idx: number): IIndexPosition {
    let line = 0;
    for (let i = 0; i < idx; i++) {
        if (markdown.charCodeAt(i) === 10 /* \n */)
            line++;
    }
    const lastNewline = markdown.lastIndexOf('\n', idx - 1);

    return { line, ch: idx - (lastNewline + 1) };
}

function _findOffsetInMarkdown(
    markdown: string,
    sentinel: string,
): IIndexPosition | null {
    const idx = markdown.indexOf(sentinel);
    if (idx === -1)
        return null;

    return _lineColAt(markdown, idx);
}

// Resolve both markers to sentinel-free line/ch coordinates.
// Return null if a required marker was lost during serialization.
export function locateSentinelOffsets(markdown: string): IIndexCursor | null {
    const detected = _detectToken(markdown);
    if (!detected)
        return null;

    const anchorRaw = _findOffsetInMarkdown(markdown, detected.anchor);
    const focusRaw = _findOffsetInMarkdown(markdown, detected.focus);

    if (!anchorRaw && !focusRaw)
        return null;

    const anchorIdx = markdown.indexOf(detected.anchor);
    const focusIdx = markdown.indexOf(detected.focus);

    const cleanLineCh = (
        raw: IIndexPosition | null,
        ownIdx: number,
        otherIdx: number,
        otherLen: number,
    ): IIndexPosition | null => {
        if (!raw)
            return null;
        // Only same-line earlier sentinels shift `ch`; earlier-line ones don't.
        if (otherIdx !== -1 && otherIdx < ownIdx) {
            const otherLine = _lineColAt(markdown, otherIdx).line;
            if (otherLine === raw.line)
                return { line: raw.line, ch: raw.ch - otherLen };
        }

        return raw;
    };

    const anchor = cleanLineCh(anchorRaw, anchorIdx, focusIdx, detected.focus.length);
    const focus = cleanLineCh(focusRaw, focusIdx, anchorIdx, detected.anchor.length);

    return {
        anchor: anchor ?? focus,
        focus: focus ?? anchor,
    };
}
