type Paddable = {
    paddingBottomInPixels: number;
    paddingTopInPixels: number;
    paddingLeftInPixels: number;
    paddingRightInPixels: number;
}

export function guiPadding(paddable: Paddable, top: number, _right?: number, _bottom?: number, _left?: number) {
    const right = _right === undefined ? top : _right
    const bottom = _bottom === undefined ? top : _bottom
    const left = _left === undefined ? right : _left;
    paddable.paddingTopInPixels = top
    paddable.paddingRightInPixels = right
    paddable.paddingBottomInPixels = bottom
    paddable.paddingLeftInPixels = left
}