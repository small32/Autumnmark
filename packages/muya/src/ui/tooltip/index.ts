// eslint-disable-next-line ts/ban-ts-comment
// @ts-nocheck

import type { Muya } from '../../index';
import './index.css';

function position(source, ele) {
    const rect = source.getBoundingClientRect();
    const { top, right, height } = rect;

    Object.assign(ele.style, {
        top: `${top + height + 15}px`,
        left: `${right - ele.offsetWidth / 2 - 10}px`,
    });
}

class Tooltip {
    private _muya: Muya;
    private _cache: WeakMap<HTMLElement, HTMLElement>;
    private _cleanup: WeakMap<HTMLElement, () => void>;

    constructor(muya) {
        this._muya = muya;
        this._cache = new WeakMap();
        this._cleanup = new WeakMap();
        const { domNode, eventCenter } = this._muya;

        eventCenter.attachDOMEvent(
            domNode,
            'mouseover',
            this._mouseOver.bind(this),
        );
    }

    private _mouseOver(event) {
        const { target } = event;
        const toolTipTarget = target.closest('[data-tooltip]');
        if (toolTipTarget && !this._cache.has(toolTipTarget)) {
            const tooltip = toolTipTarget.getAttribute('data-tooltip');
            const tooltipEle = document.createElement('div');
            tooltipEle.textContent = tooltip;
            tooltipEle.classList.add('mu-tooltip');
            document.body.appendChild(tooltipEle);
            position(toolTipTarget, tooltipEle);

            this._cache.set(toolTipTarget, tooltipEle);

            setTimeout(() => {
                tooltipEle.classList.add('active');
            });

            // The timer and the mouseleave listener must die with the tooltip:
            // a stable handler (not a fresh bind) plus a stored cleanup, so
            // repeated hovers no longer leak one interval + one listener each.
            const handler = (leaveEvent) => {
                this._mouseLeave(leaveEvent);
            };
            const timer = setInterval(() => {
                if (!document.body.contains(toolTipTarget))
                    this._mouseLeave({ target: toolTipTarget });
            }, 300);
            this._cleanup.set(toolTipTarget, () => {
                clearInterval(timer);
                toolTipTarget.removeEventListener('mouseleave', handler);
            });
            toolTipTarget.addEventListener('mouseleave', handler);
        }
    }

    private _mouseLeave(event) {
        const { target } = event;
        if (this._cache.has(target)) {
            const tooltipEle = this._cache.get(target);
            tooltipEle.remove();
            this._cache.delete(target);
            const cleanup = this._cleanup.get(target);
            if (cleanup) {
                cleanup();
                this._cleanup.delete(target);
            }
        }
    }
}

export default Tooltip;
