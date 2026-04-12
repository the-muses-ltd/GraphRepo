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

const hasModifier = (node: Node, modifier: string): boolean =>
  kids(node).some((c) => c.type === "modifier" && c.text === modifier);

const extractCalls = (node: Node): string[] => {
  const calls: string[] = [];
  const walk = (n: Node) => {
    if (n.type === "invocation_expression") {
      const func = n.childForFieldName("function");
      if (func) {
        if (func.type === "identifier") {
          calls.push(func.text);
        } else if (func.type === "member_access_expression") {
          const name = func.childForFieldName("name");
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

const extractMethodsFromBody = (body: Node): ParsedFunction[] => {
  const methods: ParsedFunction[] = [];

  for (const member of namedKids(body)) {
    if (member.type === "method_declaration") {
      const name = getText(member.childForFieldName("name"));
      if (name) {
        const params = member.childForFieldName("parameters");
        const returnType = member.childForFieldName("type");
        methods.push({
          name,
          parameters: params?.text ?? "()",
          returnType: returnType?.text ?? null,
          startLine: member.startPosition.row + 1,
          endLine: member.endPosition.row + 1,
          isExported: hasModifier(member, "public"),
          isAsync: hasModifier(member, "async"),
          kind: "method",
          calls: extractCalls(member),
        });
      }
    } else if (member.type === "constructor_declaration") {
      const name = getText(member.childForFieldName("name"));
      if (name) {
        const params = member.childForFieldName("parameters");
        methods.push({
          name,
          parameters: params?.text ?? "()",
          returnType: null,
          startLine: member.startPosition.row + 1,
          endLine: member.endPosition.row + 1,
          isExported: hasModifier(member, "public"),
          isAsync: false,
          kind: "method",
          calls: extractCalls(member),
        });
      }
    }
  }

  return methods;
};

export const extractFunctions = (root: Node): ParsedFunction[] => {
  // C# top-level methods are inside class bodies — standalone functions are rare.
  // We extract methods from top-level classes and return them here for graph purposes.
  // (The class extractor puts them into the class.methods array too.)
  return [];
};

export const extractClasses = (root: Node): ParsedClass[] => {
  const classes: ParsedClass[] = [];

  const walk = (node: Node) => {
    if (node.type === "class_declaration" || node.type === "struct_declaration" || node.type === "record_declaration") {
      const name = getText(node.childForFieldName("name"));
      if (!name) return;

      const body = node.childForFieldName("body");

      // Extract base classes/interfaces from base_list
      let superClass: string | null = null;
      const interfaces: string[] = [];
      const baseList = node.childForFieldName("bases");
      if (baseList) {
        for (const child of namedKids(baseList)) {
          if (child.type === "identifier" || child.type === "qualified_name" || child.type === "generic_name") {
            const typeName = child.text;
            // Convention: interfaces start with I in C#
            if (!superClass && !typeName.startsWith("I")) {
              superClass = typeName;
            } else if (typeName.startsWith("I") && typeName.length > 1 && typeName[1] === typeName[1].toUpperCase()) {
              interfaces.push(typeName);
            } else if (!superClass) {
              superClass = typeName;
            } else {
              interfaces.push(typeName);
            }
          }
        }
      }

      const methods = body ? extractMethodsFromBody(body) : [];

      classes.push({
        name,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExported: hasModifier(node, "public"),
        isAbstract: hasModifier(node, "abstract"),
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
    if (node.type === "interface_declaration") {
      const name = getText(node.childForFieldName("name"));
      if (name) {
        interfaces.push({
          name,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: hasModifier(node, "public"),
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
    if (node.type === "class_declaration" || node.type === "struct_declaration") {
      const body = node.childForFieldName("body");
      if (body) {
        for (const member of namedKids(body)) {
          if (member.type === "field_declaration") {
            const varDecl = namedKids(member).find((c) => c.type === "variable_declaration");
            if (varDecl) {
              const typeNode = varDecl.childForFieldName("type");
              for (const declarator of namedKids(varDecl)) {
                if (declarator.type === "variable_declarator") {
                  const name = getText(declarator.firstNamedChild);
                  if (name) {
                    variables.push({
                      name,
                      type: typeNode?.text ?? null,
                      isExported: hasModifier(member, "public"),
                      startLine: member.startPosition.row + 1,
                      kind: "const",
                    });
                  }
                }
              }
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
  return variables;
};

export const extractImports = (root: Node): ParsedImport[] => {
  const imports: ParsedImport[] = [];

  for (const node of namedKids(root)) {
    if (node.type === "using_directive") {
      // Extract the namespace name (identifier or qualified_name)
      const nameNode = namedKids(node).find(
        (c) => c.type === "identifier" || c.type === "qualified_name"
      );
      const specifier = nameNode?.text ?? "";
      if (specifier) {
        imports.push({
          specifier,
          names: [specifier.split(".").pop() ?? specifier],
          isDefault: false,
          isExternal: true,
          resolvedPath: null,
        });
      }
    }
  }

  return imports;
};

export const extractExports = (root: Node): ParsedExport[] => {
  const exports: ParsedExport[] = [];

  const walk = (node: Node) => {
    if (node.type === "class_declaration" || node.type === "struct_declaration") {
      if (hasModifier(node, "public")) {
        const name = getText(node.childForFieldName("name"));
        if (name) {
          exports.push({ name, isDefault: false, kind: "class" });
        }
      }
      return;
    }

    if (node.type === "interface_declaration") {
      if (hasModifier(node, "public")) {
        const name = getText(node.childForFieldName("name"));
        if (name) {
          exports.push({ name, isDefault: false, kind: "interface" });
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
