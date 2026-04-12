/**
 * Empty shim for the `sharp` native image processing module.
 * Transformers.js imports sharp at module load time for image pipelines,
 * but we only use text embeddings (feature-extraction) so it's never called.
 */
export default {};
