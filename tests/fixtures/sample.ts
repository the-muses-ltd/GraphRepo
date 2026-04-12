import { readFile } from "fs/promises";
import path from "path";

export const MAX_SIZE = 1024;

export interface Config {
  name: string;
}

export class Parser {
  parse(input: string): string[] {
    return input.split("\n");
  }
}

export function processFile(filePath: string): void {
  const data = readFile(filePath);
  console.log(data);
}

export default function main() {}
