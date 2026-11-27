import type { Tokens } from 'marked';
import type { ILexOption } from '../utils/marked/types';
import type { ITocItem } from './getTOC';
import type { IHtmlHeading } from './headings';
import type { TState } from './types';
import { parseFenceLine } from '../utils';
import { contentTabHeading, contentTabsMarker, findContentTabGroups } from '../utils/contentTabs';
import { foldBlockMarker } from '../utils/foldBlocks';
import { lexSourceBlocks } from '../utils/marked/lexBlock';
import { DEFAULT_OPTIONS } from '../utils/marked/options';
import { uniqueHeadingSlug } from '../utils/slug';
import { headingLabel } from './getTOC';
import { htmlHeadings } from './headings';

interface ISectionBlock<H> {
    offset: number;
    blank?: boolean;
    html?: string;
    heading?: H;
}

/** A cut before a wrapper's title includes its opening marker. Cuts in different wrappers cannot be exchanged. */
function sectionBoundaries<H>(blocks: ISectionBlock<H>[], length: number) {
    const headings: Array<H & { offset: number; sectionStart: number; scope: number }> = [];
    const scopes: Array<{ kind: string; offset: number }> = [];
    let opening: { start: number; scope: number } | undefined;
    for (const { offset, blank, html, heading } of blocks) {
        if (blank)
            continue;
        const scope = scopes.at(-1)?.offset ?? -1;
        const fold = foldBlockMarker(html ?? '');
        const tab = contentTabsMarker(html ?? '');
        if (tab || fold) {
            const kind = tab ? 'tabs' : 'fold';
            if ((tab ?? fold) === 'end') {
                if (scopes.at(-1)?.kind === kind)
                    scopes.pop();
                opening = undefined;
            }
            else {
                opening ??= { start: offset, scope };
                scopes.push({ kind, offset });
            }
            continue;
        }
        if (heading) {
            const boundary = opening ?? { start: offset, scope };
            headings.push({ ...heading, offset, sectionStart: boundary.start, scope: boundary.scope });
        }
        opening = undefined;
    }
    return { headings, endScope: scopes.at(-1)?.offset ?? -1, length };
}

export function getStateSections(state: TState[]) {
    return sectionBoundaries(state.map((block, offset) => ({
        offset,
        blank: block.name === 'paragraph' && !block.text.trim(),
        html: block.name === 'html-block' ? block.text : undefined,
        heading: block.name === 'atx-heading' || block.name === 'setext-heading' ? { lvl: block.meta.level } : undefined,
    })), state.length);
}

function isUnclosedFence(raw: string): boolean {
    const fence = parseFenceLine(raw);
    if (!fence)
        return false;
    const close = new RegExp(`\\n {0,3}${fence.fenceChar}{${fence.fenceLength},}[ \\t]*\\n*$`);
    return !close.test(raw);
}

interface IMarkdownHeading {
    token: Tokens.Heading;
    text: string;
    profile: 'atx-heading' | 'setext-heading';
}

function outlineHeadingEntries(tokens: ReturnType<typeof lexSourceBlocks>['tokens']) {
    const entries: (IHtmlHeading | IMarkdownHeading)[] = [];
    const visit = (children: typeof tokens) => {
        const tabBlocks = children.map(token => ({
            marker: token.type === 'html' ? contentTabsMarker(token.raw) : undefined,
            heading: token.type === 'heading' ? contentTabHeading(token.raw.replace(/\n+$/, '')) : undefined,
        }));
        const panels = new Set(findContentTabGroups(tabBlocks).flatMap(group => group.headings));
        for (const [index, token] of children.entries()) {
            if (token.type === 'heading') {
                const raw = token.raw.replace(/\n+$/, '');
                const atx = /^ {0,3}#{1,6}(?:[ \t]|$)/.test(raw);
                const text = atx ? raw : raw.slice(0, raw.lastIndexOf('\n'));
                entries.push({
                    token: token as Tokens.Heading,
                    text: panels.has(index) ? contentTabHeading(text)!.source : text,
                    profile: atx ? 'atx-heading' : 'setext-heading',
                });
            }
            else if (token.type === 'html') {
                entries.push(...htmlHeadings(token.raw));
            }
            else if (token.type === 'list') {
                for (const item of (token as Tokens.List).items)
                    visit(item.tokens);
            }
            else if ((token.type === 'blockquote' || token.type === 'multilineBlockquote') && 'tokens' in token && Array.isArray(token.tokens)) {
                visit(token.tokens);
            }
        }
    };
    visit(tokens);
    return entries;
}

/** Source editor offsets refer to LF-normalized Markdown. Only root headings appear in the sidebar. */
export function getMarkdownOutline(markdown: string, preferences: ILexOption = {}) {
    const options = { ...DEFAULT_OPTIONS };
    for (const key of Object.keys(options) as (keyof ILexOption)[])
        options[key] = preferences[key] ?? options[key];
    const { tokens, lexer } = lexSourceBlocks(markdown, options);
    const labels = new Map(Object.entries(lexer.tokens.links).map(([key, { href, title }]) =>
        [key, { href, title: title ?? '' }]));
    const headings = new Map<Tokens.Heading, ReturnType<typeof headingLabel>>();
    const entries = outlineHeadingEntries(tokens);
    const seen = new Set(entries.flatMap(entry => 'id' in entry && entry.id ? [entry.id] : []));
    for (const entry of entries) {
        if ('token' in entry)
            headings.set(entry.token, headingLabel(entry.text, { profile: entry.profile, labels, options }, seen));
        else if (!entry.id)
            uniqueHeadingSlug(entry.text, seen);
    }
    const blocks: ISectionBlock<ITocItem>[] = [];
    let at = 0;
    for (const token of tokens) {
        const offset = markdown.indexOf(token.raw, at);
        if (offset < 0)
            continue;
        at = offset + token.raw.length;
        const block: ISectionBlock<ITocItem> = { offset, blank: token.type === 'space', html: token.type === 'html' ? token.raw : undefined };
        if (token.type === 'heading') {
            block.heading = {
                lvl: token.depth,
                ...headings.get(token as Tokens.Heading)!,
                slug: `source-${offset}`,
            };
        }
        blocks.push(block);
    }
    const outline = sectionBoundaries(blocks, markdown.length);
    const last = tokens.at(-1);
    // EOF closes an unfinished fence. Moving that boundary would turn the following section into code.
    if (last?.type === 'code' && last.codeBlockStyle !== 'indented' && isUnclosedFence(last.raw))
        outline.endScope = markdown.length;
    return outline;
}
