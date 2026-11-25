import { parse, postprocess, preprocess } from 'micromark';
import { compactImagePayloads, findDocumentImages } from '../../clipboard/pastedImageSources';
import { imageToMarkdown } from '../image';
import { decodeInlineDrawing, encodeInlineDrawing, INLINE_DRAWING_DATA_PREFIX, isInlineDrawingSource } from './drawingData';

export function inlineDrawingToMarkdown(source: string, label: string): string {
    return imageToMarkdown({
        src: encodeInlineDrawing(source),
        alt: label.replace(/[[\]\\]/g, '\\$&'),
    });
}

interface IDrawingFence {
    kind: 'fence';
    start: number;
    end: number;
    prefix: string;
    source: string;
    markup: { start: number; end: number };
}

interface IInlineDrawing {
    kind: 'inline';
    start: number;
    end: number;
    source: string | undefined;
    markup: { start: number; end: number };
}

/** Offsets address LF-normalized Markdown. The edit range sits inside the full markup range. */
export function findEmbeddedDrawings(markdown: string, images?: ReturnType<typeof findDocumentImages>): (IDrawingFence | IInlineDrawing)[] {
    const drawings: (IDrawingFence | IInlineDrawing)[] = /[`~]{3,}[ \t]*excalidraw\b/.test(markdown)
        ? findDrawingFences(markdown)
        : [];
    if (!markdown.includes(INLINE_DRAWING_DATA_PREFIX))
        return drawings;
    for (const image of images ?? findDocumentImages(markdown)) {
        if (isInlineDrawingSource(image.src) && image.referenceTitle === undefined && image.unquotedAttribute === undefined && image.markup) {
            const { src, start, end, markup } = image;
            drawings.push({
                kind: 'inline',
                start,
                end,
                markup,
                get source() { return decodeInlineDrawing(src); },
            });
        }
    }
    return drawings.sort((first, second) => first.start - second.start);
}

function findDrawingFences(markdown: string): IDrawingFence[] {
    const { text, original } = compactImagePayloads(markdown);
    const events = postprocess(parse().document().write(preprocess()(text, undefined, true)));
    const drawings: IDrawingFence[] = [];
    let markupStart = 0;
    let bodyStart = 0;
    let isDrawing = false;
    let lines: string[] = [];
    for (const [event, token] of events) {
        if (event === 'enter' && token.type === 'codeFenced') {
            markupStart = original(token.start.offset);
            bodyStart = 0;
            isDrawing = false;
            lines = [];
        }
        if (event === 'enter' && token.type === 'codeFencedFenceInfo')
            isDrawing = text.slice(token.start.offset, token.end.offset) === 'excalidraw';
        if (!isDrawing)
            continue;
        if (event === 'enter' && token.type === 'codeFlowValue')
            lines.push(markdown.slice(original(token.start.offset), original(token.end.offset)));
        if (event !== 'exit' || token.type !== 'codeFencedFence')
            continue;
        if (!bodyStart) {
            bodyStart = original(token.end.offset) + 1;
        }
        else {
            const fenceStart = original(token.start.offset);
            const end = markdown.lastIndexOf('\n', fenceStart - 1) + 1;
            const markup = { start: markupStart, end: original(token.end.offset) };
            drawings.push({ kind: 'fence', start: bodyStart, end, markup, prefix: markdown.slice(end, fenceStart), source: lines.join('\n') });
            isDrawing = false;
        }
    }
    return drawings;
}
