import type { DefaultTreeAdapterTypes } from 'parse5';
import { parse, postprocess, preprocess } from 'micromark';
import { parseFragment } from 'parse5';
import { findEmbeddedImages } from '../utils/embeddedImage';
import { decodeMarkdownString } from '../utils/markdownEscape';

export interface IPastedImageSource {
    src: string;
    start: number;
    end: number;
    unquotedAttribute?: boolean;
    referenceTitle?: string;
    markup?: { start: number; end: number };
}

export function embeddedImageDestination(image: IPastedImageSource, dataUrl: string) {
    if (image.referenceTitle !== undefined)
        return `(${dataUrl}${image.referenceTitle ? ` ${image.referenceTitle}` : ''})`;
    // Base64 padding is not valid inside an unquoted CommonMark HTML attribute.
    return image.unquotedAttribute ? `"${dataUrl}"` : dataUrl;
}

function htmlMedia(html: string, offset: number, images: IPastedImageSource[], videos?: IPastedImageSource[], inlineVideo = false) {
    if (!/<(?:img|video|source)\b/i.test(html))
        return;
    function visit(node: DefaultTreeAdapterTypes.Node, inVideo: boolean) {
        const tag = 'tagName' in node ? node.tagName : '';
        const targets = tag === 'img' ? images : tag === 'video' || (inVideo && tag === 'source') ? videos : undefined;
        if (targets && 'tagName' in node) {
            const attr = node.sourceCodeLocation?.attrs?.src;
            const src = node.attrs.find(attr => attr.name === 'src')?.value;
            if (attr && src) {
                const raw = html.slice(attr.startOffset, attr.endOffset);
                const prefix = /^src\s*=\s*(["']?)/i.exec(raw);
                if (prefix)
                    targets.push({ src, start: offset + attr.startOffset + prefix[0].length, end: offset + attr.endOffset - prefix[1].length, unquotedAttribute: !prefix[1] });
            }
        }
        if ('childNodes' in node) {
            for (const child of node.childNodes)
                visit(child, tag ? tag === 'video' : inVideo);
        }
    }
    visit(parseFragment(html, { sourceCodeLocationInfo: true }), inlineVideo);
}

interface IImageUse {
    type: 'image' | 'link';
    label: string;
    labelEnd: number;
    reference?: string;
    hasResource?: boolean;
}

function referenceKey(value: string) {
    return value.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase();
}

export function compactImagePayloads(markdown: string) {
    // Keep multi-megabyte media payloads out of the tokenizer while retaining offsets in the editor's text.
    const cuts: { end: number; removed: number }[] = [];
    let removed = 0;
    const text = markdown.replace(/(data:(?:image|video)\/[\w.+;=-]+;base64,)[a-z\d+/=]{128,}/gi, (match: string, header: string, offset: number) => {
        const end = offset - removed + header.length + 1;
        removed += match.length - header.length - 1;
        cuts.push({ end, removed });
        return `${header}A`;
    });
    function original(offset: number) {
        let low = 0;
        let high = cuts.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (cuts[mid].end <= offset)
                low = mid + 1;
            else
                high = mid;
        }
        return offset + (cuts[low - 1]?.removed ?? 0);
    }
    return { text, original };
}

function collectImageToken(owner: IImageUse, type: string, raw: () => string, start: number, end: number, images: IPastedImageSource[]) {
    switch (type) {
        case 'label':
            owner.labelEnd = end;
            owner.label = raw().slice(2, -1);
            break;
        case 'referenceString':
            owner.reference = raw();
            break;
        case 'resource':
            owner.hasResource = true;
            break;
        case 'resourceDestinationString':
            images.push({ src: decodeMarkdownString(raw()), start, end });
            break;
    }
}

function readDefinition(events: IterableIterator<ReturnType<typeof postprocess>[number]>, text: string) {
    let key = '';
    let src = '';
    let title = '';
    for (const [event, token] of events) {
        if (token.type === 'definition' && event === 'exit')
            break;
        if (event !== 'enter')
            continue;
        const value = () => text.slice(token.start.offset, token.end.offset);
        if (token.type === 'definitionLabelString')
            key = referenceKey(value());
        if (token.type === 'definitionDestinationString')
            src = decodeMarkdownString(value());
        if (token.type === 'definitionTitle')
            title = value();
    }
    return { key, src, title };
}

type TMediaToken = ReturnType<typeof postprocess>[number][1];

/** Reference images are rewritten at the use site because ordinary links can share their definition. */
function finishImageUse(owners: IImageUse[], end: number, references: { key: string; image: IPastedImageSource }[]) {
    const owner = owners.pop();
    if (owner?.type === 'image' && !owner.hasResource) {
        references.push({
            key: referenceKey(owner.reference || owner.label),
            image: { src: '', start: owner.labelEnd, end },
        });
    }
}

function documentSources(markdown: string, includeVideos: boolean) {
    const images: IPastedImageSource[] = [];
    const videos: IPastedImageSource[] = [];
    if (!/!\[|<img\b|data:image\//i.test(markdown) && !(includeVideos && /<video\b/i.test(markdown)))
        return { images, videos };
    const { text, original } = compactImagePayloads(markdown);
    let inlineVideo = false;
    const owners: IImageUse[] = [];
    const definitions = new Map<string, { src: string; title: string }>();
    const references: { key: string; image: IPastedImageSource }[] = [];
    const events = postprocess(parse().document().write(preprocess()(text, undefined, true))).values();
    function collect(token: TMediaToken) {
        const { type, start, end } = token;
        const raw = () => text.slice(start.offset, end.offset);
        const owner = owners.at(-1);
        if (type === 'definition') {
            const definition = readDefinition(events, text);
            if (!definitions.has(definition.key))
                definitions.set(definition.key, definition);
        }
        else if (type === 'data' && !owner) {
            for (const image of findEmbeddedImages(raw()))
                images.push({ src: image.src, start: start.offset + image.start, end: start.offset + image.end });
        }
        else if (type === 'htmlText' || type === 'htmlFlow') {
            const html = raw();
            htmlMedia(html, start.offset, images, includeVideos ? videos : undefined, type === 'htmlText' && inlineVideo);
            if (type === 'htmlText' && /^<\/?video\b/i.test(html))
                inlineVideo = html[1] !== '/';
        }
        else if (owner?.type === 'image') {
            collectImageToken(owner, type, raw, start.offset, end.offset, images);
        }
    }
    for (const [event, token] of events) {
        const { type, start, end } = token;
        if (type === 'image' || type === 'link') {
            if (event === 'enter')
                owners.push({ type, label: '', labelEnd: start.offset });
            else
                finishImageUse(owners, end.offset, references);
        }
        else if (event === 'enter') {
            collect(token);
        }
        else if (type === 'paragraph') {
            inlineVideo = false;
        }
    }
    for (const { key, image } of references) {
        const def = definitions.get(key);
        if (def)
            images.push({ ...image, src: def.src, referenceTitle: def.title });
    }
    const restoreOffsets = (sources: IPastedImageSource[]) => sources.sort((a, b) => a.start - b.start).map(image => ({
        ...image,
        start: original(image.start),
        end: original(image.end),
    }));
    return { images: restoreOffsets(images), videos: restoreOffsets(videos) };
}

export function findDocumentImages(markdown: string): IPastedImageSource[] {
    return documentSources(markdown, false).images;
}

export function findLinkedDocumentMedia(markdown: string) {
    const { images, videos } = documentSources(markdown, true);
    const media = [...images.map(image => ({ ...image, kind: 'image' as const })), ...videos.map(video => ({ ...video, kind: 'video' as const }))];
    return media.filter(({ src }) => isLinkedSource(src)).sort((a, b) => a.start - b.start);
}

function isLinkedSource(src: string) {
    return src && !src.startsWith('#')
        && (!/^[a-z][\w+.-]*:/i.test(src) || /^(?:https?:\/\/|file:\/\/|[a-z]:[\\/])/i.test(src));
}

export function findPastedImageSources(markdown: string): IPastedImageSource[] {
    return findDocumentImages(markdown).filter(({ src, referenceTitle }) => referenceTitle === undefined && isLinkedSource(src));
}
