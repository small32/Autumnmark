import type Content from '../block/base/content';
import type Parent from '../block/base/parent';
import type { IInlineParseOptions } from '../inline/parser/types';
import type { Muya } from '../muya';
import type { IHtmlHeading } from './headings';
import { parseInline } from '../inline/parser/lexer';
import { tokensToInlineHtml, tokensToPlainText } from '../inline/projection';
import { getUniqueId } from '../utils';
import { generateGithubSlug, uniqueHeadingSlug } from '../utils/slug';
import { htmlHeadings } from './headings';

export interface ITocItem {
    content: string;
    contentHtml: string;
    lvl: number;
    slug: string;
    githubSlug: string;
    anchor: string;
}

interface IHeadingBlock extends Parent {
    readonly blockName: 'atx-heading' | 'setext-heading';
    meta: { level: number };
}

const slugCache = new WeakMap<Parent, string>();

export function headingLabel(text: string, parseOptions: IInlineParseOptions, seen: Set<string>) {
    const tokens = parseInline(text, parseOptions);
    const content = tokensToPlainText(tokens).trim();
    return {
        content,
        contentHtml: tokensToInlineHtml(tokens).trim(),
        githubSlug: generateGithubSlug(content),
        anchor: uniqueHeadingSlug(content, seen),
    };
}

export function stableSlug(block: Parent): string {
    let slug = slugCache.get(block);
    if (slug == null) {
        slug = getUniqueId();
        slugCache.set(block, slug);
    }
    return slug;
}

export function getTOC(muya: Muya): ITocItem[] {
    const { scrollPage } = muya.editor;
    if (!scrollPage)
        return [];

    // Headings are tokenized outside a rendered block, so the reference
    // definitions a heading may link to (`[text][ref]`) have to be collected
    // here instead of from the block's own inline renderer.
    const labels = muya.editor.inlineEngine.collectReferenceDefinitions();
    const headings: (IHeadingBlock | IHtmlHeading)[] = [];
    const seen = new Set<string>();
    const visit = (parent: Parent) => {
        for (const node of parent.children.iterator()) {
            const { blockName } = node;
            if (blockName === 'atx-heading' || blockName === 'setext-heading') {
                headings.push(node as IHeadingBlock);
            }
            else if (blockName === 'html-block' && node.isParent()) {
                for (const heading of htmlHeadings(node.firstContentInDescendant()?.text ?? '')) {
                    headings.push(heading);
                    if (heading.id)
                        seen.add(heading.id);
                }
            }
            else if (blockName !== 'footnote' && node.isParent()) {
                // Export relocates footnotes after the main document.
                visit(node);
            }
        }
    };
    visit(scrollPage);

    const { cjkEmphasis, superSubScript, footnote, texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash, highlightSyntax, inlineDiff } = muya.options;
    const options = { cjkEmphasis, superSubScript, footnote, texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash, highlightSyntax, inlineDiff };
    const items: ITocItem[] = [];
    for (const heading of headings) {
        if (!('blockName' in heading)) {
            if (!heading.id)
                uniqueHeadingSlug(heading.text, seen);
            continue;
        }

        const head = heading.children.head as Content | null;
        const text = muya.editor.contentTabs.headingSource(heading, head?.text ?? '');
        const label = headingLabel(text, { profile: heading.blockName, labels, options }, seen);
        if (heading.parent === scrollPage)
            items.push({ ...label, lvl: heading.meta.level, slug: stableSlug(heading) });
    }

    return items;
}
