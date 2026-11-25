import type { Token } from '../../inline/model/types';

export const INLINE_DRAWING_DATA_PREFIX = 'data:application/x-excalidraw;base64,';

export function isInlineDrawingSource(src: string): boolean {
    return src.startsWith(INLINE_DRAWING_DATA_PREFIX);
}

export function isInlineDrawingImage(token: Token): boolean {
    return token.type === 'image' && isInlineDrawingSource(token.attrs.src);
}

export function encodeInlineDrawing(source: string): string {
    const bytes = new TextEncoder().encode(source);
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
    return INLINE_DRAWING_DATA_PREFIX + btoa(chunks.join(''));
}

export function decodeInlineDrawing(src: string): string | undefined {
    if (!isInlineDrawingSource(src))
        return;
    try {
        const bytes = Uint8Array.from(atob(src.slice(INLINE_DRAWING_DATA_PREFIX.length)), char => char.charCodeAt(0));
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch {
        return undefined;
    }
}
