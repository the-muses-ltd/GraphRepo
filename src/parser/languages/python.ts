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

const extractCalls = (node: Node): string[] => {
  const calls: string[] = [];
  const walk = (n: Node) => {
    if (n.type === "call") {
      const func = n.childForFieldName("function");
      if (func) {
        if (func.type === "identifier") {
          calls.push(func.text);
        } else if (func.type === "attribute") {
          const attr = func.childForFieldName("attribute");
          if (attr) calls.push(attr.text);
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

const extractParams = (node: Node): string => {
  const params = node.childForFieldName("parameters");
  return params ? params.text : "()";
};

const extractReturnType = (node: Node): string | null => {
  const returnType = node.childForFieldName("return_type");
  if (!returnType) return null;
  const typeNode = returnType.firstNamedChild;
  return typeNode ? typeNode.text : returnType.text.replace(/^->\s*/, "");
};

export const extractFunctions = (root: Node): ParsedFunction[] => {
  const functions: ParsedFunction[] = [];

  const walk = (node: Node, depth: number = 0) => {
    if (node.type === "function_definition") {
      if (depth === 0) {
        const name = getText(node.childForFieldName("name"));
        if (name) {
          functions.push({
            name,
            parameters: extractParams(node),
            returnType: extractReturnType(node),
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            isExported: !name.startsWith("_"),
            isAsync: node.text.startsWith("async "),
            kind: "function",
            calls: extractCalls(node),
          });
        }
        return;
      }
    }

    for (const child of namedKids(node)) {
      walk(child, depth);
    }
  };

  walk(root);
  return functions;
};

export const extractClasses = (root: Node): ParsedClass[] => {
  const classes: ParsedClass[] = [];

  const walk = (node: Node) => {
    if (node.type === "class_definition") {
      const name = getText(node.childForFieldName("name"));
      const body = node.childForFieldName("body");

      let superClass: string | null = null;
      const interfaces: string[] = [];
      const superclasses = node.childForFieldName("superclasses");
      if (superclasses) {
        for (const arg of namedKids(superclasses)) {
          if (arg.type === "identifier" || arg.type === "attribute") {
            if (!superClass) {
              superClass = arg.text;
            } else {
              interfaces.push(arg.text);
            }
          }
        }
      }

      const methods: ParsedFunction[] = [];
      if (body) {
        for (const member of namedKids(body)) {
          const funcNode =
            member.type === "function_definition"
              ? member
              : member.type === "decorated_definition"
                ? namedKids(member).find((c) => c.type === "function_definition") ?? null
                : null;

          if (funcNode) {
            const methodName = getText(funcNode.childForFieldName("name"));
            if (methodName) {
              methods.push({
                name: methodName,
                parameters: extractParams(funcNode),
                returnType: extractReturnType(funcNode),
                startLine: funcNode.startPosition.row + 1,
                endLine: funcNode.endPosition.row + 1,
                isExported: !methodName.startsWith("_"),
                isAsync: funcNode.text.startsWith("async "),
                kind: "method",
                calls: extractCalls(funcNode),
              });
            }
          }
        }
      }

      classes.push({
        name,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExported: !name.startsWith("_"),
        isAbstract: false,
        superClass,
        interfaces,
        methods,
      });
      return;
    }

    for (const child of namedKids(node)) {
      walk(child);
    }
  };

  walk(root);
  return classes;
};

export const extractInterfaces = (_root: Node): ParsedInterface[] => [];

export const extractVariables = (root: Node): ParsedVariable[] => {
  const variables: ParsedVariable[] = [];

  for (const node of namedKids(root)) {
    if (node.type === "expression_statement") {
      const expr = node.firstNamedChild;
      if (expr?.type === "assignment") {
        const left = expr.childForFieldName("left");
        if (left?.type === "identifier") {
          const typeNode = expr.childForFieldName("type");
          variables.push({
            name: left.text,
            type: typeNode ? typeNode.text : null,
            isExported: !left.text.startsWith("_"),
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
    if (node.type === "import_statement") {
      for (const child of namedKids(node)) {
        if (child.type === "dotted_name" || child.type === "aliased_import") {
          const name =
            child.type === "aliased_import"
              ? getText(child.childForFieldName("alias") ?? child.childForFieldName("name"))
              : child.text;
          const specifier =
            child.type === "aliased_import"
              ? getText(child.childForFieldName("name"))
              : child.text;

          imports.push({
            specifier,
            names: [name],
            isDefault: true,
            isExternal: true,
            resolvedPath: null,
          });
        }
      }
    } else if (node.type === "import_from_statement") {
      const module = node.childForFieldName("module_name");
      const specifier = module ? module.text : "";
      const isExternal = !specifier.startsWith(".");

      const names: string[] = [];
      for (const child of namedKids(node)) {
        if (child.type === "import_prefix") continue;
        if (child.type === "dotted_name" && child === module) continue;
        if (child.type === "relative_import") continue;

        if (child.type === "aliased_import") {
          const alias = child.childForFieldName("alias");
          const childName = child.childForFieldName("name");
          names.push(alias?.text ?? childName?.text ?? child.text);
        } else if (child.type === "dotted_name" || child.type === "identifier") {
          names.push(child.text);
        }
      }

      imports.push({ specifier, names, isDefault: false, isExternal, resolvedPath: null });
    }
  }

  return imports;
};

export const extractExports = (root: Node): ParsedExport[] => {
  const exports: ParsedExport[] = [];

  for (const node of namedKids(root)) {
    if (node.type === "function_definition") {
      const name = getText(node.childForFieldName("name"));
      if (name && !name.startsWith("_")) {
        exports.push({ name, isDefault: false, kind: "function" });
      }
    } else if (node.type === "class_definition") {
      const name = getText(node.childForFieldName("name"));
      if (name && !name.startsWith("_")) {
        exports.push({ name, isDefault: false, kind: "class" });
      }
    } else if (node.type === "decorated_definition") {
      const inner = namedKids(node).find(
        (c) => c.type === "function_definition" || c.type === "class_definition"
      );
      if (inner) {
        const name = getText(inner.childForFieldName("name"));
        if (name && !name.startsWith("_")) {
          exports.push({
            name,
            isDefault: false,
            kind: inner.type === "function_definition" ? "function" : "class",
          });
        }
      }
    }
  }

  return exports;
};
