// Merges parsed modules into a single OID tree.

import type {
  Diagnostic,
  MibNode,
  MibTree,
  MissingImport,
  NodeKind,
  ObjectDef,
  ParsedModule,
  SymbolLookup,
  TypeDef,
  UnresolvedObject,
} from './types';

const WELL_KNOWN_ROOTS: Record<string, number> = { ccitt: 0, iso: 1, 'joint-iso-ccitt': 2 };

/**
 * Builds the tree. When several modules share a name the last one wins, so
 * user files listed after the built-in ones replace them.
 */
export function buildTree(parsed: ParsedModule[], extraDiagnostics: Diagnostic[] = []): MibTree {
  const diagnostics: Diagnostic[] = [...extraDiagnostics];
  const modules = new Map<string, ParsedModule>();
  for (const mod of parsed) {
    const previous = modules.get(mod.name);
    if (previous) {
      modules.delete(mod.name);
      diagnostics.push({
        severity: 'warning',
        message: `módulo ${mod.name} definido mais de uma vez; usando o de ${mod.file ?? '?'}`,
        module: mod.name,
        file: mod.file,
      });
    }
    modules.set(mod.name, mod);
  }

  const symbols = new SymbolTable(modules);
  const root = makeNode('', -1, [], null);
  const byOid = new Map<string, MibNode>([['', root]]);
  const unresolved: UnresolvedObject[] = [];
  const namedArcs: { oid: number[]; name: string }[] = [];

  // ---- OID resolution ------------------------------------------------------

  const memo = new Map<ObjectDef, number[] | null>();
  const failure = new Map<ObjectDef, string>();
  const inProgress = new Set<ObjectDef>();

  const resolveName = (name: string, fromModule: string): { oid: number[] | null; reason?: string } => {
    const def = symbols.lookupObject(name, fromModule);
    if (def) {
      const oid = resolve(def);
      return oid ? { oid } : { oid: null, reason: `"${name}" não resolvido (${failure.get(def) ?? 'ciclo'})` };
    }
    if (name in WELL_KNOWN_ROOTS) return { oid: [WELL_KNOWN_ROOTS[name]] };
    const source = symbols.importSource(name, fromModule);
    if (source && !modules.has(source)) return { oid: null, reason: `"${name}" vem de ${source}, que não foi carregado` };
    return { oid: null, reason: `"${name}" não encontrado` };
  };

  const resolve = (def: ObjectDef): number[] | null => {
    if (memo.has(def)) return memo.get(def)!;
    if (inProgress.has(def)) {
      failure.set(def, 'referência circular');
      return null;
    }
    inProgress.add(def);

    let oid: number[] | null = null;
    let reason: string | undefined;

    if (def.macro === 'TRAP-TYPE') {
      // RFC 3584: an SMIv1 trap maps to enterprise.0.specific-trap.
      if (!def.enterprise || def.trapNumber === undefined) {
        reason = 'TRAP-TYPE sem ENTERPRISE';
      } else {
        const r = resolveName(def.enterprise, def.module);
        oid = r.oid && [...r.oid, 0, def.trapNumber];
        reason = r.reason;
      }
    } else {
      const [first, ...rest] = def.oid;
      if (!first) {
        reason = 'OID vazio';
      } else if (first.name === undefined) {
        oid = [first.number!];
      } else {
        const r = resolveName(first.name, def.module);
        if (r.oid) oid = [...r.oid];
        else if (first.number !== undefined) oid = [first.number];
        else reason = r.reason;
      }
      for (const comp of rest) {
        if (!oid) break;
        if (comp.number === undefined) {
          oid = null;
          reason = `componente de OID sem número: "${comp.name}"`;
          break;
        }
        oid.push(comp.number);
        if (comp.name) namedArcs.push({ oid: [...oid], name: comp.name });
      }
    }

    inProgress.delete(def);
    memo.set(def, oid);
    if (!oid) failure.set(def, reason ?? 'desconhecido');
    return oid;
  };

  // ---- node creation -------------------------------------------------------

  const ensure = (oid: number[]): MibNode => {
    const key = oid.join('.');
    const existing = byOid.get(key);
    if (existing) return existing;
    const parent = ensure(oid.slice(0, -1));
    const arc = oid[oid.length - 1];
    const node = makeNode(oid.length === 1 ? (rootName(arc) ?? '') : '', arc, oid, parent);
    parent.children.push(node);
    byOid.set(key, node);
    return node;
  };

  ensure([1]);

  for (const mod of modules.values()) {
    for (const def of mod.objects) {
      const oid = resolve(def);
      if (!oid) {
        unresolved.push({ name: def.name, module: def.module, reason: failure.get(def) ?? 'desconhecido' });
        continue;
      }
      const node = ensure(oid);
      if (!node.def) {
        node.def = def;
        node.name = def.name;
      } else if (node.def !== def) {
        node.aliases.push(def);
      }
    }
  }

  for (const { oid, name } of namedArcs) {
    const node = byOid.get(oid.join('.'));
    if (node && !node.name) node.name = name;
  }

  // ---- finishing pass: sort, depth, kind, name index -----------------------

  const byName = new Map<string, MibNode[]>();
  const addName = (name: string, node: MibNode) => {
    const list = byName.get(name);
    if (!list) byName.set(name, [node]);
    else if (!list.includes(node)) list.push(node);
  };

  let size = 0;
  const stack: MibNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    node.children.sort((a, b) => a.arc - b.arc);
    if (node !== root) {
      size++;
      node.depth = node.parent!.depth + 1;
      node.kind = kindOf(node);
      if (node.name) addName(node.name, node);
      for (const alias of node.aliases) addName(alias.name, node);
    }
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }

  return {
    root,
    byOid,
    byName,
    modules,
    symbols,
    missingImports: findMissingImports(modules),
    unresolved,
    diagnostics,
    size,
  };
}

function makeNode(name: string, arc: number, oid: number[], parent: MibNode | null): MibNode {
  return {
    name,
    arc,
    oid,
    oidStr: oid.join('.'),
    parent,
    children: [],
    kind: parent ? 'branch' : 'root',
    aliases: [],
    depth: parent ? parent.depth + 1 : 0,
  };
}

function rootName(arc: number): string | undefined {
  return Object.keys(WELL_KNOWN_ROOTS).find((k) => WELL_KNOWN_ROOTS[k] === arc);
}

function kindOf(node: MibNode): NodeKind {
  const def = node.def;
  if (!def) return 'branch';
  switch (def.macro) {
    case 'OBJECT-TYPE':
      if (def.syntax?.base === 'SEQUENCE OF') return 'table';
      if (def.index || def.augments || node.parent?.kind === 'table') return 'entry';
      if (node.parent?.kind === 'entry') return 'column';
      return 'scalar';
    case 'NOTIFICATION-TYPE':
    case 'TRAP-TYPE':
      return 'notification';
    case 'OBJECT-GROUP':
    case 'NOTIFICATION-GROUP':
      return 'group';
    case 'MODULE-COMPLIANCE':
    case 'AGENT-CAPABILITIES':
      return 'compliance';
    case 'MODULE-IDENTITY':
      return 'module';
    default:
      return 'branch';
  }
}

function findMissingImports(modules: Map<string, ParsedModule>): MissingImport[] {
  const missing = new Map<string, Set<string>>();
  for (const mod of modules.values()) {
    for (const imp of mod.imports) {
      if (modules.has(imp.module)) continue;
      if (!missing.has(imp.module)) missing.set(imp.module, new Set());
      missing.get(imp.module)!.add(mod.name);
    }
  }
  return [...missing].map(([module, by]) => ({ module, requiredBy: [...by] })).sort((a, b) => a.module.localeCompare(b.module));
}

/**
 * Resolves names following the module's IMPORTS. When a name is neither local
 * nor correctly imported it falls back to any module that defines it, which
 * mirrors the leniency of common SNMP tools with sloppy vendor MIBs.
 */
export class SymbolTable implements SymbolLookup {
  private readonly objects = new Map<string, Map<string, ObjectDef>>();
  private readonly types = new Map<string, Map<string, TypeDef>>();
  private readonly imports = new Map<string, Map<string, string>>();
  private readonly globalObjects = new Map<string, ObjectDef>();
  private readonly globalTypes = new Map<string, TypeDef>();

  constructor(private readonly modules: Map<string, ParsedModule>) {
    for (const mod of modules.values()) {
      const objs = new Map<string, ObjectDef>();
      for (const o of mod.objects) {
        objs.set(o.name, o);
        if (!this.globalObjects.has(o.name)) this.globalObjects.set(o.name, o);
      }
      const types = new Map<string, TypeDef>();
      for (const t of mod.types) {
        types.set(t.name, t);
        if (!this.globalTypes.has(t.name)) this.globalTypes.set(t.name, t);
      }
      const imps = new Map<string, string>();
      for (const clause of mod.imports) for (const s of clause.symbols) imps.set(s, clause.module);
      this.objects.set(mod.name, objs);
      this.types.set(mod.name, types);
      this.imports.set(mod.name, imps);
    }
  }

  importSource(name: string, fromModule: string): string | undefined {
    return this.imports.get(fromModule)?.get(name);
  }

  lookupObject(name: string, fromModule: string): ObjectDef | undefined {
    return this.lookup(this.objects, name, fromModule, 0) ?? this.globalObjects.get(name);
  }

  lookupType(name: string, fromModule: string): TypeDef | undefined {
    return this.lookup(this.types, name, fromModule, 0) ?? this.globalTypes.get(name);
  }

  private lookup<T>(table: Map<string, Map<string, T>>, name: string, fromModule: string, depth: number): T | undefined {
    const local = table.get(fromModule)?.get(name);
    if (local) return local;
    const source = this.importSource(name, fromModule);
    // Follow re-exports, but never loop forever.
    if (source && this.modules.has(source) && depth < 8) return this.lookup(table, name, source, depth + 1);
    return undefined;
  }
}

// ---- helpers used by the UI ------------------------------------------------

export function displayName(node: MibNode): string {
  return node.name || String(node.arc);
}

/** Ancestors from the top-level arc down to `node` (excluding the virtual root). */
export function pathTo(node: MibNode): MibNode[] {
  const path: MibNode[] = [];
  for (let n: MibNode | null = node; n && n.kind !== 'root'; n = n.parent) path.push(n);
  return path.reverse();
}

export function namedOid(node: MibNode): string {
  return pathTo(node).map(displayName).join('.');
}
