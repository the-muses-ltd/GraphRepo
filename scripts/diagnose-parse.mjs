/**
 * Diagnostic script: parse each file in a test project individually
 * and report any errors from the extractor pipeline.
 *
 * Usage: npx tsx scripts/diagnose-parse.mjs <path-to-test-project>
 */
import fs from "fs";
import path from "path";
import { getParser } from "../src/parser/tree-sitter-init.js";
import { extractFromFile } from "../src/parser/extract.js";
import { EXTENSION_TO_LANGUAGE } from "../src/types.js";

const testDir = process.argv[2];
if (!testDir) {
  console.error("Usage: npx tsx scripts/diagnose-parse.mjs <path-to-test-project>");
  process.exit(1);
}

const files = fs.readdirSync(testDir).filter((f) => fs.statSync(path.join(testDir, f)).isFile());

let passed = 0;
let failed = 0;

for (const file of files) {
  const ext = path.extname(file);
  const language = EXTENSION_TO_LANGUAGE[ext];
  if (!language) {
    console.log(`SKIP ${file} (unknown extension ${ext})`);
    continue;
  }

  const codeLanguages = ["typescript", "javascript", "python", "c", "cpp", "csharp", "swift"];
  if (!codeLanguages.includes(language)) {
    console.log(`SKIP ${file} (non-code language: ${language})`);
    continue;
  }

  const filePath = path.join(testDir, file);
  const content = fs.readFileSync(filePath, "utf-8");

  try {
    console.log(`\nParsing ${file} (${language})...`);
    const parser = await getParser(language);
    console.log(`  Parser loaded OK`);

    const result = extractFromFile(file, content, language, parser);
    console.log(`  OK: ${result.functions.length} functions, ${result.classes.length} classes, ${result.interfaces.length} interfaces, ${result.variables.length} variables, ${result.imports.length} imports`);
    passed++;
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    console.error(`  Stack: ${err.stack}`);
    failed++;
  }
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed out of ${passed + failed} code files ---`);
