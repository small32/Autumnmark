import type { Nullable } from '../../../types';
import type Content from '../../base/content';
import type DiagramBlock from './index';
import { isHiddenByFold } from '../../folding';

export function embeddedDrawingFor(content: Nullable<Content>): DiagramBlock | undefined {
    if (!content)
        return;
    const options = content.muya.options as (typeof content.muya.options & { embeddedDrawing?: boolean });
    if (!options.embeddedDrawing || !(content as unknown as { isInert?: boolean }).isInert)
        return;

    const drawing = content.closestBlock('diagram') as DiagramBlock | null;
    if (!drawing || drawing.meta.type !== ('excalidraw' as typeof drawing.meta.type) || isHiddenByFold(drawing))
        return;

    const { contentTabs, foldBlocks } = content.muya.editor;
    if (!contentTabs.isHidden(content) && !foldBlocks.isHidden(content))
        return drawing;
}
