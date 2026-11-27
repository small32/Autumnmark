import type { DefaultTreeAdapterTypes } from 'parse5';
import { Lexer } from 'marked';
import { parseFragment } from 'parse5';
import { beginRules } from '../inline/parser/rules';

export interface IHtmlHeading {
    id: string;
    text: string;
}

function htmlText(node: DefaultTreeAdapterTypes.ChildNode): string {
    return 'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(htmlText).join('') : '';
}

export function htmlHeadings(source: string): IHtmlHeading[] {
    if (!/<h[1-6]\b/i.test(source))
        return [];
    const headings: IHtmlHeading[] = [];
    function visit(nodes: DefaultTreeAdapterTypes.ChildNode[]) {
        for (const node of nodes) {
            if ('tagName' in node && /^h[1-6]$/.test(node.tagName))
                headings.push({ id: node.attrs.find(attr => attr.name === 'id')?.value ?? '', text: htmlText(node) });
            if ('childNodes' in node)
                visit(node.childNodes);
        }
    }
    visit(parseFragment(source).childNodes);
    return headings;
}

/** The inline Markdown body, without ATX markers or their surrounding whitespace. */
export function atxHeadingBody(text: string): string {
    const token = Lexer.lex(text, { gfm: true })[0];
    return token?.type === 'heading' ? token.text : text;
}

export function atxHeadingPrefixLength(text: string): number {
    return beginRules.header.exec(text)?.[0].length ?? 0;
}

export function atxHeadingBodyRange(text: string) {
    const start = atxHeadingPrefixLength(text);
    return { start, end: start + atxHeadingBody(text).length };
}

// Structural splits keep trailing heading syntax out of the new paragraph.
export function splitAtxHeading(text: string, start: number, end: number) {
    const { start: bodyStart, end: bodyEnd } = atxHeadingBodyRange(text);
    const inBody = start >= bodyStart && end <= bodyEnd;
    return {
        head: text.slice(0, start),
        tail: text.slice(end, inBody ? bodyEnd : undefined),
        suffix: inBody ? text.slice(bodyEnd) : '',
    };
}

export function changeAtxHeadingLevel(text: string, level: number): string {
    const opening = beginRules.header.exec(text)?.[0];
    if (opening === undefined)
        return `${'#'.repeat(level)} ${text}`;
    const start = opening.indexOf('#');
    const length = opening.trim().length;
    return text.slice(0, start) + '#'.repeat(level) + text.slice(start + length);
}
