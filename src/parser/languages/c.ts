import type { SyntaxNode } from "../tree-sitter-init.js";
import type {
  ParsedFunction,
  ParsedClass,
  ParsedInterface,
  ParsedVariable,
  ParsedImport,
  ParsedExport,
} from "../../types.js";

type Node = SyntaxNode;

const kids = (node: Node): Node[] =>
  node.children.filter((c): c is Node => c !== null);

const namedKids = (node: Node): Node[] =>
  node.namedChildren.filter((c): c is Node => c !== null);

const getText = (node: Node | null): string => node?.text ?? "";

const hasStorageClass = (node: Node, keyword: string): boolean =>
  kids(node).some((c) => c.type === "storage_class_specifier" && c.text === keyword);

const extractCalls = (node: Node): string[] => {
  const calls: string[] = [];
  const walk = (n: Node) => {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      if (func) {
        if (func.type === "identifier") {
          calls.push(func.text);
        } else if (func.type === "field_expression") {
          const field = func.childForFieldName("field");
          if (field) calls.push(field.text);
        }
      }
    }
    for (const child of kids(n)) {
      walk(child);
    }
  };
  walk(node);
  return [...new Set(calls)];
};

/** Extract function name from C's declarator chain: function_definition → declarator (function_declarator → declarator (identifier)) */
const getFuncName = (node: Node): string => {
  const declarator = node.childForFieldName("declarator");
  if (!declarator) return "";
  if (declarator.type === "function_declarator") {
    const inner = declarator.childForFieldName("declarator");
    return inner?.text ?? "";
  }
  return "";
};

const getFuncParams = (node: Node): string => {
  const declarator = node.childForFieldName("declarator");
  if (declarator?.type === "function_declarator") {
    const params = declarator.childForFieldName("parameters");
    return params?.text ?? "()";
  }
  return "()";
};

const getReturnType = (node: Node): string | null => {
  const typeNode = node.childForFieldName("type");
  return typeNode?.text ?? null;
};

export const extractFunctions = (root: Node): ParsedFunction[] => {
  const functions: ParsedFunction[] = [];

  for (const node of namedKids(root)) {
    if (node.type === "function_definition") {
      const name = getFuncName(node);
      if (name) {
        const isStatic = hasStorageClass(node, "static");
        functions.push({
          name,
          parameters: getFuncParams(node),
          returnType: getReturnType(node),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: !isStatic,
          isAsync: false,
          kind: "function",
          calls: extractCalls(node),
        });
      }
    }
  }

  return functions;
};

export const extractClasses = (_root: Node): ParsedClass[] => [];

export const extractInterfaces = (_root: Node): ParsedInterface[] => [];

export const extractVariables = (root: Node): ParsedVariable[] => {
  const variables: ParsedVariable[] = [];

  for (const node of namedKids(root)) {
    if (node.type === "declaration") {
      const typeNode = node.childForFieldName("type");
      const typeName = typeNode?.text ?? null;
      const isStatic = hasStorageClass(node, "static");

      for (const child of namedKids(node)) {
        if (child.type === "init_declarator") {
          const declarator = child.childForFieldName("declarator");
          if (declarator?.type === "identifier") {
            variables.push({
              name: declarator.text,
              type: typeName,
              isExported: !isStatic,
              startLine: node.startPosition.row + 1,
              kind: "const",
            });
          }
        } else if (child.type === "identifier") {
          variables.push({
            name: child.text,
            type: typeName,
            isExported: !isStatic,
            startLine: node.startPosition.row + 1,
            kind: "const",
          });
        }
      }
    }
  }

  return variables;
};

export const extractImports = (root: Node): ParsedImport[] => {
  const imports: ParsedImport[] = [];

  for (const node of namedKids(root)) {
    if (node.type === "preproc_include") {
      const pathNode = node.childForFieldName("path");
      if (pathNode) {
        const isSystem = pathNode.type === "system_lib_string";
        // Strip quotes/angle brackets
        const raw = pathNode.text;
        const specifier = raw.replace(/^[<"]|[>"]$/g, "");

        imports.push({
          specifier,
          names: [],
          isDefault: false,
          isExternal: isSystem,
          resolvedPath: null,
        });
      }
    }
  }

  return imports;
};

export const extractExports = (root: Node): ParsedExport[] => {
  const exports: ParsedExport[] = [];

  for (const node of namedKids(root)) {
    if (node.type === "function_definition") {
      const name = getFuncName(node);
      if (name && !hasStorageClass(node, "static")) {
        exports.push({ name, isDefault: false, kind: "function" });
      }
    } else if (node.type === "declaration") {
      const isStatic = hasStorageClass(node, "static");
      if (!isStatic) {
        for (const child of namedKids(node)) {
          if (child.type === "init_declarator") {
            const declarator = child.childForFieldName("declarator");
            if (declarator?.type === "identifier") {
              exports.push({ name: declarator.text, isDefault: false, kind: "variable" });
            }
          }
        }
      }
    }
  }

  return exports;
};
