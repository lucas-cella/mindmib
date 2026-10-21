// Resolves a SYNTAX through TEXTUAL-CONVENTIONs and type assignments down to
// its ASN.1 base type, collecting the effective enumerations and constraints.

import type { MibTree, NamedNumber, Range, SyntaxSpec, TypeDef } from './types';

const PRIMITIVES = new Set([
  'INTEGER',
  'OCTET STRING',
  'OBJECT IDENTIFIER',
  'BITS',
  'BIT STRING',
  'SEQUENCE',
  'SEQUENCE OF',
  'CHOICE',
  'NULL',
]);

export interface ResolvedSyntax {
  declared: SyntaxSpec;
  /** Types traversed from the declared one towards the base, in order. */
  chain: TypeDef[];
  /** Final ASN.1 type, e.g. `OCTET STRING`. */
  baseType: string;
  enums?: NamedNumber[];
  ranges?: Range[];
  sizes?: Range[];
  displayHint?: string;
}

export function resolveSyntax(tree: MibTree, spec: SyntaxSpec, module: string): ResolvedSyntax {
  const result: ResolvedSyntax = {
    declared: spec,
    chain: [],
    baseType: spec.base,
    enums: spec.enums,
    ranges: spec.ranges,
    sizes: spec.sizes,
  };

  let current = spec;
  let currentModule = module;
  const seen = new Set<TypeDef>();
  while (!PRIMITIVES.has(current.base)) {
    const td = tree.symbols.lookupType(current.base, currentModule);
    if (!td || seen.has(td)) break;
    seen.add(td);
    result.chain.push(td);
    // The most specific refinement wins: the declared syntax first, then
    // each type in the chain.
    result.enums ??= td.syntax.enums;
    result.ranges ??= td.syntax.ranges;
    result.sizes ??= td.syntax.sizes;
    result.displayHint ??= td.displayHint;
    current = td.syntax;
    currentModule = td.module;
  }
  result.baseType = current.base;
  return result;
}

export function formatRanges(ranges: Range[]): string {
  return ranges.map((r) => (r.min === r.max ? r.min : `${r.min}..${r.max}`)).join(' | ');
}
