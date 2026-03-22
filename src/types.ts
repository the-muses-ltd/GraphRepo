import { z } from "zod";

export const LanguageSchema = z.enum(["typescript", "javascript", "python", "json", "markdown", "css", "html", "other"]);
export type Language = z.infer<typeof LanguageSchema>;

export const EXTENSION_TO_LANGUAGE: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".json": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".css": "css",
  ".scss": "css",
  ".less": "css",
  ".html": "html",
  ".htm": "html",
  ".svg": "other",
  ".png": "other",
  ".jpg": "other",
  ".jpeg": "other",
  ".gif": "other",
  ".ico": "other",
  ".yaml": "other",
  ".yml": "other",
  ".toml": "other",
  ".xml": "other",
  ".txt": "other",
  ".env.example": "other",
  ".gitignore": "other",
  ".dockerignore": "other",
  ".prettierrc": "other",
  ".eslintrc": "other",
  ".sh": "other",
  ".bash": "other",
  ".zsh": "other",
  ".bat": "other",
  ".cmd": "other",
  ".ps1": "other",
  ".sql": "other",
  ".graphql": "other",
  ".gql": "other",
  ".proto": "other",
  ".lock": "other",
};

// --- Parsed entities (parser output) ---

export const ParsedImportSchema = z.object({
  specifier: z.string(),
  names: z.array(z.string()),
  isDefault: z.boolean(),
  isExternal: z.boolean(),
  resolvedPath: z.string().nullable(),
});
export type ParsedImport = z.infer<typeof ParsedImportSchema>;

export const ParsedExportSchema = z.object({
  name: z.string(),
  isDefault: z.boolean(),
  kind: z.enum(["function", "class", "variable", "interface", "type", "unknown"]),
});
export type ParsedExport = z.infer<typeof ParsedExportSchema>;

export const ParsedFunctionSchema = z.object({
  name: z.string(),
  parameters: z.string(),
  returnType: z.string().nullable(),
  startLine: z.number(),
  endLine: z.number(),
  isExported: z.boolean(),
  isAsync: z.boolean(),
  kind: z.enum(["function", "arrow", "method", "generator"]),
  calls: z.array(z.string()),
});
export type ParsedFunction = z.infer<typeof ParsedFunctionSchema>;

export const ParsedClassSchema = z.object({
  name: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  isExported: z.boolean(),
  isAbstract: z.boolean(),
  superClass: z.string().nullable(),
  interfaces: z.array(z.string()),
  methods: z.array(ParsedFunctionSchema),
});
export type ParsedClass = z.infer<typeof ParsedClassSchema>;

export const ParsedInterfaceSchema = z.object({
  name: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  isExported: z.boolean(),
});
export type ParsedInterface = z.infer<typeof ParsedInterfaceSchema>;

export const ParsedVariableSchema = z.object({
  name: z.string(),
  type: z.string().nullable(),
  isExported: z.boolean(),
  startLine: z.number(),
  kind: z.enum(["const", "let", "var"]),
});
export type ParsedVariable = z.infer<typeof ParsedVariableSchema>;

export const ParsedFileSchema = z.object({
  path: z.string(),
  language: LanguageSchema,
  size: z.number(),
  lineCount: z.number(),
  functions: z.array(ParsedFunctionSchema),
  classes: z.array(ParsedClassSchema),
  interfaces: z.array(ParsedInterfaceSchema),
  variables: z.array(ParsedVariableSchema),
  imports: z.array(ParsedImportSchema),
  exports: z.array(ParsedExportSchema),
});
export type ParsedFile = z.infer<typeof ParsedFileSchema>;

export type ParsedRepository = {
  files: ParsedFile[];
  externalModules: string[];
};
