import fs from 'fs';
import path from 'path';

const wasmModule = require('./sitelen_wasm.js') as {
    initSync: (arg: { module: Uint8Array }) => void;
    init: () => void;
    render_png: (text: string, optimalRatio: number | null) => Uint8Array;
    render_svg: (text: string, optimalRatio: number | null) => string;
};

let initialized = false;

function ensureInit(): void {
    if (initialized) return;
    const wasmBytes = fs.readFileSync(path.join(__dirname, 'sitelen_wasm_bg.wasm'));
    wasmModule.initSync({ module: wasmBytes });
    initialized = true;
}

export function renderSitelenPng(text: string, optimalRatio: number | null = null): Buffer {
    ensureInit();
    const bytes = wasmModule.render_png(text, optimalRatio);
    return Buffer.from(bytes);
}

export function renderSitelenSvg(text: string, optimalRatio: number | null = null): string {
    ensureInit();
    return wasmModule.render_svg(text, optimalRatio);
}
