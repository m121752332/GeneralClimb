import { ResolutionPolicy, screen, view } from 'cc';

/**
 * Portrait game on any screen: screens taller than the design keep the full
 * width (extra space above / below), wider screens keep the full height
 * (extra space left / right). The design size comes from Project Settings.
 */
export function applyScreenFit(): void {
    const design = view.getDesignResolutionSize();
    const designRatio = design.height / design.width;

    const fit = (): void => {
        const win = screen.windowSize;
        const policy = win.height / win.width >= designRatio
            ? ResolutionPolicy.FIXED_WIDTH
            : ResolutionPolicy.FIXED_HEIGHT;
        view.setDesignResolutionSize(design.width, design.height, policy);
    };

    fit();
    view.setResizeCallback(fit);
}
