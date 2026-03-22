// JavaScript shares the same AST structure as TypeScript for the constructs we care about.
// We re-export all TypeScript extractors — they work on JS ASTs too.
export {
  extractFunctions,
  extractClasses,
  extractInterfaces,
  extractVariables,
  extractImports,
  extractExports,
} from "./typescript.js";
