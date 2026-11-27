import type { ILexOption } from './types';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import Prism from 'prismjs';
import { codeFenceLanguage } from '../codeFenceAnnotations';
import compactNestedLists from './compactNestedLists';
import codeFenceAnnotationsExtension from './extensions/codeFenceAnnotations';
import contentTabsExtension from './extensions/contentTabs';
import emojiExtension from './extensions/emoji';
import fancyListsHtmlExtension from './extensions/fancyListsHtml';
import foldBlocksExtension from './extensions/foldBlocks';
import footnoteExtension from './extensions/footnote';
import githubAlertsExtension from './extensions/githubAlerts';
import inlineDelimitersExtension from './extensions/inlineDelimiters';
import inlineDiffExtension from './extensions/inlineDiff';
import markExtension from './extensions/mark';
import mathExtension, { doubleBackslashMathExtension, gfmMathExtension, singleBackslashMathExtension } from './extensions/math';
import multilineBlockquoteExtension from './extensions/multilineBlockquote';
import referenceDefinitionTabs from './extensions/referenceDefinitionTabs';
import superSubScriptExtension from './extensions/superSubscript';
import tableLayoutExtension from './extensions/tableLayout';
import fm, { frontMatterRender } from './frontMatter';
import { DEFAULT_OPTIONS } from './options';
import { preserveCodeTabs } from './restoreCodeTabs';
import walkTokens from './walkTokens';

const DIAGRAM_TYPE = [
    'mermaid',
    'plantuml',
    'vega-lite',
    'flowchart',
    'sequence',
];

function highlight(code: string, _language: string, info: string) {
    const lang = codeFenceLanguage(info);
    if (!lang)
        return code;

    if (DIAGRAM_TYPE.includes(lang))
        return code;

    const grammar = Prism.languages[lang];
    if (!grammar) {
        console.warn(`Unable to find grammar for "${lang}".`);
        return code;
    }
    return Prism.highlight(code, grammar, lang);
}

export function getHighlightHtml(src: string, options: ILexOption = {}) {
    options = Object.assign({}, DEFAULT_OPTIONS, options);
    const { footnote, frontMatter, texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash, superSubScript, highlightSyntax, inlineDiff, multilineBlockquote, fancyLists }
        = options;

    // Use a fresh Marked instance; repeated use() chains walkTokens and corrupts repeated renders.
    const marked = new Marked(markedHighlight({ highlight }), foldBlocksExtension(), referenceDefinitionTabs());
    marked.use(codeFenceAnnotationsExtension());
    marked.use(tableLayoutExtension());

    marked.use({
        walkTokens: walkTokens({ texMathDollars, texMathGfm }),
    });

    marked.use(inlineDelimitersExtension(options.cjkEmphasis));

    marked.use(emojiExtension({ isRenderEmoji: true }));

    if (texMathDollars) {
        marked.use(
            mathExtension({
                throwOnError: false,
                useKatexRender: true,
            }),
        );
    }

    if (texMathGfm) {
        marked.use(
            gfmMathExtension({
                throwOnError: false,
                useKatexRender: true,
            }),
        );
    }

    if (texMathSingleBackslash) {
        marked.use(
            singleBackslashMathExtension({
                throwOnError: false,
                useKatexRender: true,
            }),
        );
    }

    if (texMathDoubleBackslash) {
        marked.use(
            doubleBackslashMathExtension({
                throwOnError: false,
                useKatexRender: true,
            }),
        );
    }

    if (superSubScript)
        marked.use(superSubScriptExtension());

    if (highlightSyntax)
        marked.use(markExtension());

    if (inlineDiff)
        marked.use(inlineDiffExtension());

    marked.use(multilineBlockquoteExtension(multilineBlockquote === true));
    marked.use(githubAlertsExtension(options.githubAlerts === true));
    marked.use(contentTabsExtension());

    if (footnote)
        marked.use(footnoteExtension());

    if (fancyLists)
        marked.use(fancyListsHtmlExtension());
    else
        // Export's pre-wrap stylesheet exposes marked's list-wrapper newlines (#5767).
        marked.use(compactNestedLists());

    let html = '';

    if (frontMatter) {
        const { token, src: newSrc } = fm(src);
        if (token) {
            html = frontMatterRender(token);
            src = newSrc;
        }
    }

    marked.use(preserveCodeTabs(src));
    html += marked.parse(src);

    return html;
}
