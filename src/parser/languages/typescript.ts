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

// Helper to get non-null children
const kids = (node: Node): Node[] =>
  node.children.filter((c): c is Node => c !== null);

const namedKids = (node: Node): Node[] =>
  node.namedChildren.filter((c): c is Node => c !== null);

const getText = (node: Node | null): string => node?.text ?? "";

const isExported = (node: Node): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  return (
    parent.type === "export_statement" ||
    parent.type === "export_default_declaration" ||
    node.previousNamedSibling?.type === "export_statement"
  );
};

const extractCalls = (node: Node): string[] => {
  const calls: string[] = [];
  const walk = (n: Node) => {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      if (func) {
        if (func.type === "identifier") {
          calls.push(func.text);
        } else if (func.type === "member_expression") {
          const prop = func.childForFieldName("property");
          if (prop) calls.push(prop.text);
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
  return typeNode ? typeNode.text : returnType.text.replace(/^:\s*/, "");
};

export const extractFunctions = (root: Node): ParsedFunction[] => {
  const functions: ParsedFunction[] = [];

  const walk = (node: Node) => {
    if (node.type === "function_declaration" || node.type === "generator_function_declaration") {
      const name = getText(node.childForFieldName("name"));
      if (name) {
        functions.push({
          name,
          parameters: extractParams(node),
          returnType: extractReturnType(node),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: isExported(node),
          isAsync: kids(node).some((c) => c.type === "async"),
          kind: node.type === "generator_function_declaration" ? "generator" : "function",
          calls: extractCalls(node),
        });
        return;
      }
    }

    if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      for (const declarator of namedKids(node)) {
        if (declarator.type === "variable_declarator") {
          const name = getText(declarator.childForFieldName("name"));
          const value = declarator.childForFieldName("value");
          if (
            value &&
            (value.type === "arrow_function" ||
              value.type === "function_expression" ||
              value.type === "generator_function")
          ) {
            functions.push({
              name,
              parameters: extractParams(value),
              returnType: extractReturnType(value),
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              isExported: isExported(node),
              isAsync: kids(value).some((c) => c.type === "async"),
              kind: value.type === "arrow_function" ? "arrow" : value.type === "generator_function" ? "generator" : "function",
              calls: extractCalls(value),
            });
            return;
          }
        }
      }
    }

    for (const child of namedKids(node)) {
      walk(child);
    }
  };

  walk(root);
  return functions;
};

export const extractClasses = (root: Node): ParsedClass[] => {
  const classes: ParsedClass[] = [];

  const walk = (node: Node) => {
    if (node.type === "class_declaration") {
      const name = getText(node.childForFieldName("name"));
      const body = node.childForFieldName("body");

      let superClass: string | null = null;
      const heritage = kids(node).find((c) => c.type === "class_heritage");
      if (heritage) {
        const extendsClause = kids(heritage).find((c) => c.text.startsWith("extends"));
        if (extendsClause) {
          const superNode = extendsClause.nextNamedSibling;
          if (superNode) superClass = superNode.text;
        }
      }

      const interfaces: string[] = [];
      if (heritage) {
        const hChildren = kids(heritage);
        const implementsIdx = hChildren.findIndex((c) => c.text === "implements");
        if (implementsIdx >= 0) {
          for (let i = implementsIdx + 1; i < hChildren.length; i++) {
            const child = hChildren[i];
            if (child.isNamed && child.type !== "extends_clause") {
              interfaces.push(child.text.replace(/,\s*$/, ""));
            }
          }
        }
      }

      const methods: ParsedFunction[] = [];
      if (body) {
        for (const member of namedKids(body)) {
          if (member.type === "method_definition" || member.type === "public_field_definition") {
            const methodName = getText(member.childForFieldName("name"));
            if (methodName) {
              methods.push({
                name: methodName,
                parameters: extractParams(member),
                returnType: extractReturnType(member),
                startLine: member.startPosition.row + 1,
                endLine: member.endPosition.row + 1,
                isExported: false,
                isAsync: kids(member).some((c) => c.type === "async"),
                kind: "method",
                calls: extractCalls(member),
              });
            }
          }
        }
      }

      classes.push({
        name,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExported: isExported(node),
        isAbstract: kids(node).some((c) => c.type === "abstract"),
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

export const extractInterfaces = (root: Node): ParsedInterface[] => {
  const interfaces: ParsedInterface[] = [];

  const walk = (node: Node) => {
    if (node.type === "interface_declaration" || node.type === "type_alias_declaration") {
      const name = getText(node.childForFieldName("name"));
      if (name) {
        interfaces.push({
          name,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: isExported(node),
        });
      }
      return;
    }

    for (const child of namedKids(node)) {
      walk(child);
    }
  };

  walk(root);
  return interfaces;
};

export const extractVariables = (root: Node): ParsedVariable[] => {
  const variables: ParsedVariable[] = [];

  const walk = (node: Node) => {
    if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      const kind = kids(node)[0]?.text as "const" | "let" | "var";
      for (const declarator of namedKids(node)) {
        if (declarator.type === "variable_declarator") {
          const value = declarator.childForFieldName("value");
          if (
            value &&
            (value.type === "arrow_function" ||
              value.type === "function_expression" ||
              value.type === "generator_function")
          ) {
            continue;
          }

          const name = getText(declarator.childForFieldName("name"));
          const typeAnnotation = declarator.childForFieldName("type");
          if (name) {
            variables.push({
              name,
              type: typeAnnotation ? typeAnnotation.text.replace(/^:\s*/, "") : null,
              isExported: isExported(node),
              startLine: node.startPosition.row + 1,
              kind: kind ?? "const",
            });
          }
        }
      }
      return;
    }

    for (const child of namedKids(node)) {
      walk(child);
    }
  };

  walk(root);
  return variables;
};

export const extractImports = (root: Node): ParsedImport[] => {
  const imports: ParsedImport[] = [];

  const walk = (node: Node) => {
    if (node.type === "import_statement") {
      const source = node.childForFieldName("source");
      if (!source) return;

      const specifier = source.text.replace(/['"]/g, "");
      const isExternal = !specifier.startsWith(".") && !specifier.startsWith("/");

      const names: string[] = [];
      let isDefault = false;

      for (const child of namedKids(node)) {
        if (child.type === "import_clause") {
          for (const clauseChild of namedKids(child)) {
            if (clauseChild.type === "identifier") {
              isDefault = true;
              names.push(clauseChild.text);
            } else if (clauseChild.type === "named_imports") {
              for (const spec of namedKids(clauseChild)) {
                if (spec.type === "import_specifier") {
                  const alias = spec.childForFieldName("alias");
                  const name = spec.childForFieldName("name");
                  names.push(alias?.text ?? name?.text ?? spec.text);
                }
              }
            } else if (clauseChild.type === "namespace_import") {
              names.push(clauseChild.text);
            }
          }
        }
      }

      imports.push({ specifier, names, isDefault, isExternal, resolvedPath: null });
    }

    for (const child of namedKids(node)) {
      walk(child);
    }
  };

  walk(root);
  return imports;
};

export const extractExports = (root: Node): ParsedExport[] => {
  const exports: ParsedExport[] = [];

  const walk = (node: Node) => {
    if (node.type === "export_statement") {
      const isDefault = kids(node).some((c) => c.text === "default");
      const declaration = node.childForFieldName("declaration");

      if (declaration) {
        let name = "";
        let kind: ParsedExport["kind"] = "unknown";

        if (declaration.type === "function_declaration" || declaration.type === "generator_function_declaration") {
          name = getText(declaration.childForFieldName("name"));
          kind = "function";
        } else if (declaration.type === "class_declaration") {
          name = getText(declaration.childForFieldName("name"));
          kind = "class";
        } else if (declaration.type === "lexical_declaration" || declaration.type === "variable_declaration") {
          kind = "variable";
          for (const declarator of namedKids(declaration)) {
            if (declarator.type === "variable_declarator") {
              name = getText(declarator.childForFieldName("name"));
              const value = declarator.childForFieldName("value");
              if (value && (value.type === "arrow_function" || value.type === "function_expression")) {
                kind = "function";
              }
              break;
            }
          }
        } else if (declaration.type === "interface_declaration") {
          name = getText(declaration.childForFieldName("name"));
          kind = "interface";
        } else if (declaration.type === "type_alias_declaration") {
          name = getText(declaration.childForFieldName("name"));
          kind = "type";
        }

        if (name) {
          exports.push({ name, isDefault, kind });
        }
      }

      const exportClause = kids(node).find((c) => c.type === "export_clause");
      if (exportClause) {
        for (const spec of namedKids(exportClause)) {
          if (spec.type === "export_specifier") {
            const name = getText(spec.childForFieldName("name"));
            if (name) {
              exports.push({ name, isDefault: false, kind: "unknown" });
            }
          }
        }
      }

      return;
    }

    for (const child of namedKids(node)) {
      walk(child);
    }
  };

  walk(root);
  return exports;
};
