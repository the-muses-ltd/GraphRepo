import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseFixture } from "../helpers/parse-fixture.js";
import type { Language } from "../../src/types.js";
import type { SyntaxNode } from "../../src/parser/tree-sitter-init.js";

import * as tsExtractor from "../../src/parser/languages/typescript.js";
import * as pyExtractor from "../../src/parser/languages/python.js";
import * as cExtractor from "../../src/parser/languages/c.js";
import * as cppExtractor from "../../src/parser/languages/cpp.js";
import * as csharpExtractor from "../../src/parser/languages/csharp.js";
import * as swiftExtractor from "../../src/parser/languages/swift.js";

type Extractor = typeof tsExtractor;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface LanguageTestCase {
  language: Language;
  extractor: Extractor;
  fixture: string;
  expected: {
    functionNames: string[];
    classNames: string[];
    interfaceNames: string[];
    variableNames: string[];
    importSpecifiers: string[];
    exportNames: string[];
    classMethodCounts?: Record<string, number>;
    superClasses?: Record<string, string | null>;
    asyncFunctions?: string[];
    callsContain?: Record<string, string[]>;
  };
}

const testCases: LanguageTestCase[] = [
  {
    language: "typescript",
    extractor: tsExtractor,
    fixture: "sample.ts",
    expected: {
      functionNames: ["processFile", "main"],
      classNames: ["Parser"],
      interfaceNames: ["Config"],
      variableNames: ["MAX_SIZE", "data"],
      importSpecifiers: ["fs/promises", "path"],
      exportNames: ["MAX_SIZE", "Config", "Parser", "processFile", "main"],
      classMethodCounts: { Parser: 1 },
    },
  },
  {
    language: "python",
    extractor: pyExtractor,
    fixture: "sample.py",
    expected: {
      functionNames: ["process_file", "parse"],
      classNames: ["Parser"],
      interfaceNames: [],
      variableNames: ["MAX_SIZE"],
      importSpecifiers: ["os", "pathlib"],
      exportNames: ["process_file", "Parser"],
      classMethodCounts: { Parser: 1 },
    },
  },
  {
    language: "c",
    extractor: cExtractor,
    fixture: "sample.c",
    expected: {
      functionNames: ["helper", "process"],
      classNames: [],
      interfaceNames: [],
      variableNames: ["internal_counter", "global_value"],
      importSpecifiers: ["stdio.h", "myheader.h"],
      exportNames: ["process", "global_value"],
      callsContain: { process: ["helper", "printf"] },
    },
  },
  {
    language: "cpp",
    extractor: cppExtractor,
    fixture: "sample.cpp",
    expected: {
      functionNames: ["processItems"],
      classNames: ["Animal", "Dog"],
      interfaceNames: [],
      variableNames: [],
      importSpecifiers: ["iostream", "vector", "utils.h"],
      exportNames: ["processItems", "Animal", "Dog"],
      classMethodCounts: { Animal: 2, Dog: 1 },
      superClasses: { Dog: "Animal" },
    },
  },
  {
    language: "csharp",
    extractor: csharpExtractor,
    fixture: "sample.cs",
    expected: {
      functionNames: [],
      classNames: ["BaseProcessor", "DataProcessor"],
      interfaceNames: ["IProcessor"],
      variableNames: ["_count"],
      importSpecifiers: ["System", "System.Collections.Generic"],
      exportNames: ["BaseProcessor", "DataProcessor", "IProcessor"],
      classMethodCounts: { BaseProcessor: 1, DataProcessor: 2 },
      superClasses: { DataProcessor: "BaseProcessor" },
      asyncFunctions: ["FetchAsync"],
    },
  },
  {
    language: "swift",
    extractor: swiftExtractor,
    fixture: "sample.swift",
    expected: {
      functionNames: ["createManager"],
      classNames: ["DataManager"],
      interfaceNames: ["Processable"],
      variableNames: ["count", "name"],
      importSpecifiers: ["Foundation", "UIKit"],
      exportNames: ["createManager", "DataManager", "Processable"],
      classMethodCounts: { DataManager: 2 },
      superClasses: { DataManager: "NSObject" },
    },
  },
];

describe.each(testCases)("$language extractor", (tc) => {
  let root: SyntaxNode;

  beforeAll(async () => {
    const fixturePath = path.join(__dirname, "..", "fixtures", tc.fixture);
    const code = fs.readFileSync(fixturePath, "utf-8");
    root = await parseFixture(code, tc.language);
  });

  it("extracts function names", () => {
    const functions = tc.extractor.extractFunctions(root);
    const names = functions.map((f) => f.name);
    expect(names.sort()).toEqual([...tc.expected.functionNames].sort());
  });

  it("extracts class names", () => {
    const classes = tc.extractor.extractClasses(root);
    const names = classes.map((c) => c.name);
    expect(names.sort()).toEqual([...tc.expected.classNames].sort());
  });

  it("extracts interface names", () => {
    const interfaces = tc.extractor.extractInterfaces(root);
    const names = interfaces.map((i) => i.name);
    expect(names.sort()).toEqual([...tc.expected.interfaceNames].sort());
  });

  it("extracts variable names", () => {
    const variables = tc.extractor.extractVariables(root);
    const names = variables.map((v) => v.name);
    expect(names.sort()).toEqual([...tc.expected.variableNames].sort());
  });

  it("extracts import specifiers", () => {
    const imports = tc.extractor.extractImports(root);
    const specifiers = imports.map((i) => i.specifier);
    expect(specifiers.sort()).toEqual([...tc.expected.importSpecifiers].sort());
  });

  it("extracts export names", () => {
    const exports = tc.extractor.extractExports(root);
    const names = exports.map((e) => e.name);
    expect(names.sort()).toEqual([...tc.expected.exportNames].sort());
  });

  if (tc.expected.classMethodCounts) {
    it("extracts correct method counts per class", () => {
      const classes = tc.extractor.extractClasses(root);
      for (const [className, count] of Object.entries(tc.expected.classMethodCounts!)) {
        const cls = classes.find((c) => c.name === className);
        expect(cls, `class ${className} should exist`).toBeDefined();
        expect(cls!.methods.length).toBe(count);
      }
    });
  }

  if (tc.expected.superClasses) {
    it("extracts superclass inheritance", () => {
      const classes = tc.extractor.extractClasses(root);
      for (const [className, superClass] of Object.entries(tc.expected.superClasses!)) {
        const cls = classes.find((c) => c.name === className);
        expect(cls, `class ${className} should exist`).toBeDefined();
        expect(cls!.superClass).toBe(superClass);
      }
    });
  }

  if (tc.expected.asyncFunctions) {
    it("detects async functions", () => {
      const classes = tc.extractor.extractClasses(root);
      const allMethods = classes.flatMap((c) => c.methods);
      const allFunctions = tc.extractor.extractFunctions(root);
      const all = [...allFunctions, ...allMethods];
      for (const asyncName of tc.expected.asyncFunctions!) {
        const fn = all.find((f) => f.name === asyncName);
        expect(fn, `function ${asyncName} should exist`).toBeDefined();
        expect(fn!.isAsync).toBe(true);
      }
    });
  }

  if (tc.expected.callsContain) {
    it("extracts function calls", () => {
      const functions = tc.extractor.extractFunctions(root);
      for (const [funcName, expectedCalls] of Object.entries(tc.expected.callsContain!)) {
        const fn = functions.find((f) => f.name === funcName);
        expect(fn, `function ${funcName} should exist`).toBeDefined();
        for (const call of expectedCalls) {
          expect(fn!.calls).toContain(call);
        }
      }
    });
  }
});
