/**
 * In-memory vector store for semantic search.
 * Brute-force cosine similarity — fast enough for <50K vectors at 384 dimensions.
 * Persisted to JSON with base64-encoded Float32Arrays for compact storage.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

interface VectorEntry {
  text: string;
  embedding: Float32Array;
}

export class VectorStore {
  private entries = new Map<string, VectorEntry>();

  /** Add or update an entry. */
  add(id: string, text: string, embedding: Float32Array): void {
    this.entries.set(id, { text, embedding });
  }

  /** Remove an entry. */
  remove(id: string): void {
    this.entries.delete(id);
  }

  /** Number of stored vectors. */
  get size(): number {
    return this.entries.size;
  }

  /** Clear all entries. */
  clear(): void {
    this.entries.clear();
  }

  /** Search for the top-K most similar vectors to the query. */
  search(
    queryEmbedding: Float32Array,
    topK: number = 10,
  ): { id: string; text: string; score: number }[] {
    const results: { id: string; text: string; score: number }[] = [];

    for (const [id, entry] of this.entries) {
      const score = dotProduct(queryEmbedding, entry.embedding);
      results.push({ id, text: entry.text, score });
    }

    // Sort descending by score
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /** Persist to a JSON file. Embeddings are base64-encoded for compactness. */
  save(filePath: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const serialized: Record<string, { text: string; embedding: string }> = {};
    for (const [id, entry] of this.entries) {
      serialized[id] = {
        text: entry.text,
        embedding: float32ToBase64(entry.embedding),
      };
    }

    writeFileSync(filePath, JSON.stringify(serialized), "utf-8");
  }

  /** Load from a JSON file. Returns false if file doesn't exist. */
  load(filePath: string): boolean {
    if (!existsSync(filePath)) return false;

    try {
      const raw = readFileSync(filePath, "utf-8");
      const data: Record<string, { text: string; embedding: string }> = JSON.parse(raw);

      this.entries.clear();
      for (const [id, entry] of Object.entries(data)) {
        this.entries.set(id, {
          text: entry.text,
          embedding: base64ToFloat32(entry.embedding),
        });
      }
      return true;
    } catch {
      return false;
    }
  }
}

/** Dot product of two normalized vectors (= cosine similarity). */
function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/** Encode a Float32Array as a base64 string. */
function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decode a base64 string back to a Float32Array. */
function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}
