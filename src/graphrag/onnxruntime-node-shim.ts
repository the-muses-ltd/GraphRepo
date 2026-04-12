/**
 * Empty shim for onnxruntime-node.
 * esbuild aliases 'onnxruntime-node' to this file so the top-level import
 * in Transformers.js doesn't crash. The actual ONNX backend is forced to
 * onnxruntime-web via Symbol.for('onnxruntime') in embeddings.ts.
 */
export default {};
