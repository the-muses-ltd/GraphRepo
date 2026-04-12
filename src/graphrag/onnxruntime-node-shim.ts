/**
 * Shim that redirects onnxruntime-node to onnxruntime-web.
 * esbuild aliases 'onnxruntime-node' to this file so Transformers.js's
 * IS_NODE_ENV branch uses the WASM backend instead of native binaries.
 */
// @ts-ignore — onnxruntime-web types don't resolve via package.json "exports"
export * from "onnxruntime-web";
// @ts-ignore
export { default } from "onnxruntime-web";
