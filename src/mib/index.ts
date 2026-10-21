// Public entry point of the MIB core. Nothing here touches the DOM.

import { parseMib } from './parser';
import { buildTree } from './tree';
import type { Diagnostic, MibTree, ParsedModule } from './types';

export interface SourceFile {
  name: string;
  text: string;
  builtin?: boolean;
}

/** Parses all files (in order) and merges them into one tree. */
export function loadMibs(files: SourceFile[]): MibTree {
  const modules: ParsedModule[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    const result = parseMib(file.text, file.name);
    modules.push(...result.modules);
    diagnostics.push(...result.diagnostics);
  }
  return buildTree(modules, diagnostics);
}

export { parseMib } from './parser';
export { buildTree, displayName, namedOid, pathTo } from './tree';
export { resolveSyntax, formatRanges } from './syntax';
export type * from './types';
