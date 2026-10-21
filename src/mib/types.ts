// Data model shared by the parser, the tree builder and the UI.

export type MacroKind =
  | 'OBJECT IDENTIFIER'
  | 'OBJECT-TYPE'
  | 'MODULE-IDENTITY'
  | 'OBJECT-IDENTITY'
  | 'NOTIFICATION-TYPE'
  | 'TRAP-TYPE'
  | 'OBJECT-GROUP'
  | 'NOTIFICATION-GROUP'
  | 'MODULE-COMPLIANCE'
  | 'AGENT-CAPABILITIES';

/** One component of an OID value, e.g. `iso`, `org(3)` or `6`. */
export interface OidComponent {
  name?: string;
  number?: number;
}

export interface NamedNumber {
  name: string;
  value: number;
}

/** A value or size range; bounds are kept as text to preserve hex/big values. */
export interface Range {
  min: string;
  max: string;
}

export interface SyntaxSpec {
  /** Original text, whitespace-normalised. */
  raw: string;
  /** Base type name: `INTEGER`, `OCTET STRING`, `BITS`, `DisplayString`, ... */
  base: string;
  /** Element type for `SEQUENCE OF X`. */
  sequenceOf?: string;
  /** Field list for `SEQUENCE { ... }`. */
  sequence?: { name: string; type: string }[];
  /** Named numbers of an INTEGER enumeration or BITS. */
  enums?: NamedNumber[];
  /** Value range constraint, e.g. `(0..65535)`. */
  ranges?: Range[];
  /** SIZE constraint, e.g. `(SIZE (0..255))`. */
  sizes?: Range[];
}

export interface IndexItem {
  name: string;
  implied?: boolean;
}

export interface Revision {
  date: string;
  description: string;
}

export interface ComplianceModule {
  module?: string;
  mandatoryGroups: string[];
  groups: { name: string; description?: string }[];
  objects: {
    name: string;
    syntax?: SyntaxSpec;
    writeSyntax?: SyntaxSpec;
    minAccess?: string;
    description?: string;
  }[];
}

export interface ObjectDef {
  name: string;
  module: string;
  macro: MacroKind;
  /** OID value as written. For TRAP-TYPE this is derived from ENTERPRISE. */
  oid: OidComponent[];
  line: number;
  syntax?: SyntaxSpec;
  units?: string;
  access?: string;
  status?: string;
  description?: string;
  reference?: string;
  index?: IndexItem[];
  augments?: string;
  defval?: string;
  /** OBJECTS (groups, notifications) or VARIABLES (SMIv1 traps). */
  objects?: string[];
  notifications?: string[];
  enterprise?: string;
  trapNumber?: number;
  lastUpdated?: string;
  organization?: string;
  contactInfo?: string;
  revisions?: Revision[];
  compliance?: ComplianceModule[];
  productRelease?: string;
}

export interface TypeDef {
  name: string;
  module: string;
  line: number;
  isTextualConvention: boolean;
  syntax: SyntaxSpec;
  displayHint?: string;
  status?: string;
  description?: string;
  reference?: string;
}

export interface ImportClause {
  module: string;
  symbols: string[];
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  module?: string;
  file?: string;
  line?: number;
}

export interface ParsedModule {
  name: string;
  file?: string;
  imports: ImportClause[];
  objects: ObjectDef[];
  types: TypeDef[];
  /** Names of MACROs defined by the module (their bodies are skipped). */
  macros: string[];
  diagnostics: Diagnostic[];
}

export type NodeKind =
  | 'root'
  | 'branch'
  | 'module'
  | 'scalar'
  | 'table'
  | 'entry'
  | 'column'
  | 'notification'
  | 'group'
  | 'compliance';

export interface MibNode {
  /** Empty for anonymous arcs (e.g. the `0` under an SMIv1 enterprise). */
  name: string;
  arc: number;
  oid: number[];
  oidStr: string;
  parent: MibNode | null;
  /** Sorted by arc. */
  children: MibNode[];
  kind: NodeKind;
  /** Primary definition (first module that defined this OID). */
  def?: ObjectDef;
  /** Other definitions of the same OID from other modules. */
  aliases: ObjectDef[];
  depth: number;
}

export interface UnresolvedObject {
  name: string;
  module: string;
  reason: string;
}

export interface MissingImport {
  module: string;
  requiredBy: string[];
}

export interface SymbolLookup {
  lookupObject(name: string, fromModule: string): ObjectDef | undefined;
  lookupType(name: string, fromModule: string): TypeDef | undefined;
  importSource(name: string, fromModule: string): string | undefined;
}

export interface MibTree {
  /** Virtual root whose children are ccitt(0), iso(1), joint-iso-ccitt(2). */
  root: MibNode;
  byOid: Map<string, MibNode>;
  byName: Map<string, MibNode[]>;
  modules: Map<string, ParsedModule>;
  symbols: SymbolLookup;
  missingImports: MissingImport[];
  unresolved: UnresolvedObject[];
  diagnostics: Diagnostic[];
  size: number;
}
