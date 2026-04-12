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
        } else if (func.type === "qualified_identifier") {
          const name = func.lastNamedChild;
          if (name) calls.push(name.text);
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

const getFuncName = (node: Node): string => {
  const declarator = node.childForFieldName("declarator");
  if (!declarator) return "";
  if (declarator.type === "function_declarator") {
    const inner = declarator.childForFieldName("declarator");
    if (!inner) return "";
    // Could be identifier, field_identifier, or qualified_identifier
    if (inner.type === "qualified_identifier") {
      const name = inner.lastNamedChild;
      return name?.text ?? "";
    }
    return inner.text;
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
        functions.push({
          name,
          parameters: getFuncParams(node),
          returnType: getReturnType(node),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: !hasStorageClass(node, "static"),
          isAsync: false,
          kind: "function",
          calls: extractCalls(node),
        });
      }
    }
  }

  return functions;
};

export const extractClasses = (root: Node): ParsedClass[] => {
  const classes: ParsedClass[] = [];

  for (const node of namedKids(root)) {
    if (node.type === "class_specifier" || node.type === "struct_specifier") {
      const name = getText(node.childForFieldName("name"));
      if (!name) continue;

      const body = node.childForFieldName("body");

      // Extract base classes from base_class_clause
      let superClass: string | null = null;
      const interfaces: string[] = [];
      const baseClause = namedKids(node).find((c) => c.type === "base_class_clause");
      if (baseClause) {
        for (const child of namedKids(baseClause)) {
          if (child.type === "type_identifier" || child.type === "qualified_identifier") {
            if (!superClass) {
              superClass = child.text;
            } else {
              interfaces.push(child.text);
            }
          }
        }
      }

      // Extract methods from body
      const methods: ParsedFunction[] = [];
      let isAbstract = false;

      if (body) {
        for (const member of namedKids(body)) {
          if (member.type === "function_definition") {
            const declarator = member.childForFieldName("declarator");
            if (declarator?.type === "function_declarator") {
              const nameNode = declarator.childForFieldName("declarator");
              const methodName = nameNode?.text ?? "";
              if (methodName) {
                methods.push({
                  name: methodName,
                  parameters: getFuncParams(member),
                  returnType: getReturnType(member),
                  startLine: member.startPosition.row + 1,
                  endLine: member.endPosition.row + 1,
                  isExported: false,
                  isAsync: false,
                  kind: "method",
                  calls: extractCalls(member),
                });
              }
            }
          } else if (member.type === "field_declaration") {
            // Check for pure virtual: has "virtual" and default_value "0"
            const hasVirtual = kids(member).some((c) => c.type === "virtual");
            const defaultVal = member.childForFieldName("default_value");
            if (hasVirtual && defaultVal?.text === "0") {
              isAbstract = true;
            }

            // Check if it's a method declaration (has function_declarator)
            const decl = member.childForFieldName("declarator");
            if (decl?.type === "function_declarator") {
              const nameNode = decl.childForFieldName("declarator");
              const methodName = nameNode?.text ?? "";
              if (methodName) {
                methods.push({
                  name: methodName,
                  parameters: (() => {
                    const params = decl.childForFieldName("parameters");
                    return params?.text ?? "()";
                  })(),
                  returnType: getReturnType(member),
                  startLine: member.startPosition.row + 1,
                  endLine: member.endPosition.row + 1,
                  isExported: false,
                  isAsync: false,
                  kind: "method",
                  calls: [],
                });
              }
            }
          }
        }
      }

      classes.push({
        name,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExported: true,
        isAbstract,
        superClass,
        interfaces,
        methods,
      });
    }
  }

  return classes;
};

export const extractInterfaces = (_root: Node): ParsedInterface[] => [];

export const extractVariables = (root: Node): ParsedVariable[] => {
  const variables: ParsedVariable[] = [];

  for (const node of namedKids(root)) {
    if (node.type === "declaration") {
      // Skip function declarations (have function_declarator inside)
      const hasFunc = namedKids(node).some(
        (c) => c.type === "function_declarator" ||
          (c.type === "init_declarator" && c.childForFieldName("declarator")?.type === "function_declarator")
      );
      if (hasFunc) continue;

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
    } else if (node.type === "using_declaration") {
      imports.push({
        specifier: node.text.replace(/^using\s+/, "").replace(/;$/, "").trim(),
        names: [],
        isDefault: false,
        isExternal: true,
        resolvedPath: null,
      });
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
    } else if (node.type === "class_specifier" || node.type === "struct_specifier") {
      const name = getText(node.childForFieldName("name"));
      if (name) {
        exports.push({ name, isDefault: false, kind: "class" });
      }
    }
  }

  return exports;
};
