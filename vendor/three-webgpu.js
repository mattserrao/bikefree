// The WebGPU build of three.js r187 (fidelity plan, step 1): WebGPURenderer, node materials and TSL. It shares
// three.core.min.js with the classic build (vendor/three.js), so a scene built from either draws with either renderer.
// Loaded only when the WebGPU renderer is asked for (?renderer=webgpu, the gate bench).
export * from './three.webgpu.min.js';
