/**
 * Headless DOM shim for running the real rs2b0t MapView (GameShell) under Node.
 *
 * Imported as a side-effect BEFORE MapView so `#/graphics/Canvas.js` finds a
 * fake `#canvas` element + 2D context at module top level.
 */

function fake2d(c: { width: number; height: number }) {
    return {
        fillStyle: '#000',
        strokeStyle: '#000',
        font: '10px sans-serif',
        textAlign: 'left' as CanvasTextAlign,
        createImageData(w: number, h: number) {
            return {
                data: new Uint8ClampedArray(w * h * 4),
                width: w,
                height: h,
                colorSpace: 'srgb' as const
            };
        },
        getImageData(_x: number, _y: number, w: number, h: number) {
            return {
                data: new Uint8ClampedArray(w * h * 4),
                width: w,
                height: h,
                colorSpace: 'srgb' as const
            };
        },
        putImageData() {},
        fillRect() {},
        strokeRect() {},
        fillText() {},
        measureText: () => ({ width: 8 }),
        drawImage() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        save() {},
        restore() {},
        clearRect() {},
        canvas: c
    };
}

function makeCanvas(width: number, height: number) {
    const c = {
        width,
        height,
        style: {} as Record<string, string>,
        tabIndex: 0,
        getContext(type: string) {
            if (type === '2d') {
                return fake2d(c);
            }
            return null;
        }
    };
    return c;
}

const main = makeCanvas(640, 480);

(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).document = {
    getElementById(id: string) {
        return id === 'canvas' ? main : null;
    },
    createElement(tag: string) {
        if (tag === 'canvas') {
            return makeCanvas(320, 240);
        }
        return { style: {}, setAttribute() {}, appendChild() {} };
    },
    body: { appendChild() {} }
};
(globalThis as Record<string, unknown>).HTMLCanvasElement = class {} as unknown as typeof HTMLCanvasElement;
((globalThis as Record<string, unknown>).HTMLCanvasElement as { prototype: Record<string, unknown> }).prototype.getContext = function (type: string) {
    return fake2d(this as { width: number; height: number });
};