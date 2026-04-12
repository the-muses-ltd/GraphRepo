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

const getVisibility = (node: Node): string | null => {
  for (const child of kids(node)) {
    if (child.type === "modifiers") {
      for (const mod of namedKids(child)) {
        if (mod.type === "visibility_modifier") return mod.text;
      }
    }
  }
  return null;
};

const isExported = (node: Node): boolean => {
  const vis = getVisibility(node);
  return vis === "public" || vis === "open";
};

const extractCalls = (node: Node): string[] => {
  const calls: string[] = [];
  const walk = (n: Node) => {
    if (n.type === "call_expression") {
      const firstChild = n.firstNamedChild;
      if (firstChild) {
        if (firstChild.type === "simple_identifier") {
          calls.push(firstChild.text);
        } else if (firstChild.type === "navigation_expression") {
          const suffix = namedKids(firstChild).find((c) => c.type === "navigation_suffix");
          if (suffix) {
            const id = namedKids(suffix).find((c) => c.type === "simple_identifier");
            if (id) calls.push(id.text);
          }
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

/** Extract function name — it's the first `name` field which is a simple_identifier */
const getFuncName = (node: Node): string => {
  const name = node.childForFieldName("name");
  return name?.text ?? "";
};

/** Extract parameters text from the function's parameter nodes */
const getFuncParams = (node: Node): string => {
  const params: string[] = [];
  for (const child of namedKids(node)) {
    if (child.type === "parameter") {
      params.push(child.text);
    }
  }
  return params.length ? `(${params.join(", ")})` : "()";
};

/** Extract return type — the second `name` field after parameters, which is a user_type */
const getReturnType = (node: Node): string | null => {
  // In Swift tree-sitter, return type appears after parameters as a user_type with field name "name"
  // We find it by looking for user_type or tuple_type children after all parameter children
  let foundParams = false;
  for (const child of namedKids(node)) {
    if (child.type === "parameter") {
      foundParams = true;
      continue;
    }
    if (foundParams && (child.type === "user_type" || child.type === "tuple_type" ||
        child.type === "optional_type" || child.type === "array_type")) {
      return child.text;
    }
  }
  return null;
};

export const extractFunctions = (root: Node): ParsedFunction[] => {
  const functions: ParsedFunction[] = [];

  for (const node of namedKids(root)) {
    if (node.type === "function_declaration") {
      const name = getFuncName(node);
      if (name) {
        functions.push({
          name,
          parameters: getFuncParams(node),
          returnType: getReturnType(node),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: isExported(node),
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
    if (node.type === "class_declaration" || node.type === "struct_declaration") {
      const name = getText(node.childForFieldName("name"));
      if (!name) continue;

      // Extract inheritance from inheritance_specifier children
      let superClass: string | null = null;
      const interfaces: string[] = [];
      for (const child of namedKids(node)) {
        if (child.type === "inheritance_specifier") {
          const inheritsFrom = child.childForFieldName("inherits_from");
          const typeName = inheritsFrom?.text ?? child.text;
          if (!superClass) {
            superClass = typeName;
          } else {
            interfaces.push(typeName);
          }
        }
      }

      // Extract methods from body
      const methods: ParsedFunction[] = [];
      const body = namedKids(node).find(
        (c) => c.type === "class_body" || c.type === "struct_body"
      );
      if (body) {
        for (const member of namedKids(body)) {
          if (member.type === "function_declaration") {
            const methodName = getFuncName(member);
            if (methodName) {
              methods.push({
                name: methodName,
                parameters: getFuncParams(member),
                returnType: getReturnType(member),
                startLine: member.startPosition.row + 1,
                endLine: member.endPosition.row + 1,
                isExported: isExported(member),
                isAsync: false,
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
        isAbstract: false,
        superClass,
        interfaces,
        methods,
      });
    }
  }

  return classes;
};

export const extractInterfaces = (root: Node): ParsedInterface[] => {
  const interfaces: ParsedInterface[] = [];

  for (const node of namedKids(root)) {
    if (node.type === "protocol_declaration") {
      const name = getText(node.childForFieldName("name"));
      if (name) {
        interfaces.push({
          name,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: isExported(node),
        });
      }
    }
  }

  return interfaces;
};

export const extractVariables = (root: Node): ParsedVariable[] => {
  const variables: ParsedVariable[] = [];

  const walkBody = (body: Node, checkExport: boolean) => {
    for (const node of namedKids(body)) {
      if (node.type === "property_declaration") {
        // Determine let vs var from value_binding_pattern
        const binding = namedKids(node).find((c) => c.type === "value_binding_pattern");
        const kind = binding?.text === "let" ? "let" : "var";

        // Get name from pattern child
        const pattern = namedKids(node).find((c) => c.type === "pattern");
        const nameNode = pattern?.childForFieldName("bound_identifier");
        const name = nameNode?.text ?? "";

        // Get type from type_annotation
        const typeAnnotation = namedKids(node).find((c) => c.type === "type_annotation");
        const typeNode = typeAnnotation?.childForFieldName("name");
        const typeName = typeNode?.text ?? null;

        if (name) {
          variables.push({
            name,
            type: typeName,
            isExported: checkExport ? isExported(node) : false,
            startLine: node.startPosition.row + 1,
            kind: kind as "let" | "var",
          });
        }
      }
    }
  };

  // Extract properties from class/struct bodies
  for (const node of namedKids(root)) {
    if (node.type === "class_declaration" || node.type === "struct_declaration") {
      const body = namedKids(node).find(
        (c) => c.type === "class_body" || c.type === "struct_body"
      );
      if (body) walkBody(body, true);
    }
  }

  return variables;
};

export const extractImports = (root: Node): ParsedImport[] => {
  const imports: ParsedImport[] = [];

  for (const node of namedKids(root)) {
    if (node.type === "import_declaration") {
      // The module name is in an identifier child containing simple_identifier
      const idNode = namedKids(node).find((c) => c.type === "identifier");
      const simpleId = idNode ? namedKids(idNode).find((c) => c.type === "simple_identifier") : null;
      const specifier = simpleId?.text ?? idNode?.text ?? "";

      if (specifier) {
        imports.push({
          specifier,
          names: [specifier],
          isDefault: true,
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

  for (const node of namedKids(root)) {
    if (node.type === "function_declaration" && isExported(node)) {
      const name = getFuncName(node);
      if (name) {
        exports.push({ name, isDefault: false, kind: "function" });
      }
    } else if ((node.type === "class_declaration" || node.type === "struct_declaration") && isExported(node)) {
      const name = getText(node.childForFieldName("name"));
      if (name) {
        exports.push({ name, isDefault: false, kind: "class" });
      }
    } else if (node.type === "protocol_declaration" && isExported(node)) {
      const name = getText(node.childForFieldName("name"));
      if (name) {
        exports.push({ name, isDefault: false, kind: "interface" });
      }
    }
  }

  return exports;
};
