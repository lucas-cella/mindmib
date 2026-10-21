// Recursive-descent parser for SMIv1 / SMIv2 modules.
//
// The parser is deliberately tolerant: when an assignment cannot be parsed it
// records a diagnostic and resynchronises at the next line that looks like the
// start of an assignment, so one bad definition never hides the rest of a file.

import { tokenize, type Token } from './lexer';
import type {
  ComplianceModule,
  Diagnostic,
  ImportClause,
  IndexItem,
  MacroKind,
  NamedNumber,
  ObjectDef,
  OidComponent,
  ParsedModule,
  Range,
  SyntaxSpec,
  TypeDef,
} from './types';

const VALUE_MACROS = new Set<string>([
  'OBJECT-TYPE',
  'MODULE-IDENTITY',
  'OBJECT-IDENTITY',
  'NOTIFICATION-TYPE',
  'TRAP-TYPE',
  'OBJECT-GROUP',
  'NOTIFICATION-GROUP',
  'MODULE-COMPLIANCE',
  'AGENT-CAPABILITIES',
]);

const COMPLIANCE_KEYWORDS = new Set(['MANDATORY-GROUPS', 'GROUP', 'OBJECT', 'MODULE']);

class ParseError extends Error {
  constructor(
    message: string,
    readonly token: Token,
  ) {
    super(message);
  }
}

export interface ParseResult {
  modules: ParsedModule[];
  diagnostics: Diagnostic[];
}

/** Parses every module contained in `text`. Never throws. */
export function parseMib(text: string, file?: string): ParseResult {
  return new Parser(text, file).parseFile();
}

/** Removes the common indentation of continuation lines in a quoted string. */
export function cleanText(s: string): string {
  const lines = s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  let indent = Infinity;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    indent = Math.min(indent, lines[i].match(/^[ \t]*/)![0].length);
  }
  if (indent === Infinity) indent = 0;
  const out = lines.map((l, i) => (i === 0 ? l.trimStart() : l.slice(indent)));
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n');
}

class Parser {
  private readonly toks: Token[];
  private pos = 0;
  private readonly diagnostics: Diagnostic[] = [];
  private mod: ParsedModule | null = null;

  constructor(
    private readonly src: string,
    private readonly file?: string,
  ) {
    this.toks = tokenize(src);
  }

  // ---- token helpers -------------------------------------------------------

  private peek(k = 0): Token {
    return this.toks[Math.min(this.pos + k, this.toks.length - 1)];
  }

  private next(): Token {
    const t = this.peek();
    if (t.type !== 'eof') this.pos++;
    return t;
  }

  private is(value: string, k = 0): boolean {
    const t = this.peek(k);
    return t.type !== 'string' && t.value === value;
  }

  private accept(value: string): boolean {
    if (this.is(value)) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expect(value: string): Token {
    if (!this.is(value)) this.fail(`esperado "${value}", encontrado ${describe(this.peek())}`);
    return this.next();
  }

  private expectIdent(): Token {
    if (this.peek().type !== 'ident') this.fail(`esperado identificador, encontrado ${describe(this.peek())}`);
    return this.next();
  }

  private expectNumber(): number {
    if (this.peek().type !== 'number') this.fail(`esperado número, encontrado ${describe(this.peek())}`);
    return Number(this.next().value);
  }

  private expectString(): string {
    if (this.peek().type !== 'string') this.fail(`esperado texto entre aspas, encontrado ${describe(this.peek())}`);
    return this.next().value;
  }

  private get eof(): boolean {
    return this.peek().type === 'eof';
  }

  private fail(message: string): never {
    throw new ParseError(message, this.peek());
  }

  private diag(severity: Diagnostic['severity'], message: string, line?: number) {
    this.diagnostics.push({ severity, message, module: this.mod?.name, file: this.file, line });
  }

  /**
   * Source text of tokens `from..to` (inclusive indices), keeping their
   * original spelling but dropping comments and collapsing whitespace.
   */
  private textBetween(from: number, to: number): string {
    let out = '';
    for (let i = from; i <= to; i++) {
      const t = this.toks[i];
      if (i > from && t.start > this.toks[i - 1].end) out += ' ';
      out += this.src.slice(t.start, t.end);
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  private skipBalanced(open: string, close: string): void {
    this.expect(open);
    let depth = 1;
    while (depth > 0 && !this.eof) {
      const t = this.next();
      if (t.type !== 'symbol') continue;
      if (t.value === open) depth++;
      else if (t.value === close) depth--;
    }
  }

  private atLineStart(t: Token): boolean {
    for (let i = t.start - 1; i >= 0; i--) {
      const c = this.src[i];
      if (c === '\n') return true;
      if (c !== ' ' && c !== '\t' && c !== '\r') return false;
    }
    return true;
  }

  // ---- module structure ----------------------------------------------------

  parseFile(): ParseResult {
    const modules: ParsedModule[] = [];
    while (!this.eof) {
      if (!this.seekModuleHeader()) break;
      const mod = this.parseModule();
      modules.push(mod);
    }
    if (!modules.length) {
      this.diagnostics.push({
        severity: 'error',
        message: 'nenhum módulo encontrado (falta "NOME DEFINITIONS ::= BEGIN")',
        file: this.file,
      });
    }
    return { modules, diagnostics: this.diagnostics };
  }

  /** Moves `pos` to the module name preceding the next `DEFINITIONS`. */
  private seekModuleHeader(): boolean {
    for (let i = this.pos; i < this.toks.length; i++) {
      if (this.toks[i].type !== 'ident' || this.toks[i].value !== 'DEFINITIONS') continue;
      let j = i - 1;
      // Skip an optional module OID: `Name { iso ... } DEFINITIONS`.
      if (j >= 0 && this.toks[j].value === '}') {
        let depth = 0;
        for (; j >= 0; j--) {
          if (this.toks[j].value === '}') depth++;
          else if (this.toks[j].value === '{' && --depth === 0) break;
        }
        j--;
      }
      if (j >= this.pos && this.toks[j].type === 'ident') {
        this.pos = j;
        return true;
      }
    }
    this.pos = this.toks.length - 1;
    return false;
  }

  private parseModule(): ParsedModule {
    const nameTok = this.next();
    const mod: ParsedModule = { name: nameTok.value, file: this.file, imports: [], objects: [], types: [], macros: [], diagnostics: [] };
    this.mod = mod;
    const firstDiag = this.diagnostics.length;

    if (this.is('{')) this.skipBalanced('{', '}');
    this.expect('DEFINITIONS');
    while (!this.is('::=') && !this.eof) this.next(); // tag defaults etc.
    this.expect('::=');
    this.expect('BEGIN');

    if (this.accept('EXPORTS')) {
      while (!this.eof && !this.accept(';')) this.next();
    }
    if (this.accept('IMPORTS')) mod.imports = this.parseImports();

    while (!this.eof && !this.is('END')) {
      const start = this.pos;
      try {
        this.parseAssignment(mod);
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        this.diag('error', e.message, e.token.line);
        this.recover(start);
      }
    }
    if (!this.accept('END')) this.diag('warning', 'módulo sem "END" final');

    mod.diagnostics = this.diagnostics.slice(firstDiag);
    this.mod = null;
    return mod;
  }

  /** Skips forward to the next token that plausibly starts an assignment. */
  private recover(from: number): void {
    this.pos = Math.max(from + 1, this.pos);
    while (!this.eof) {
      if (this.is('END')) return;
      if (this.looksLikeAssignment()) return;
      this.pos++;
    }
  }

  private looksLikeAssignment(): boolean {
    const t = this.peek();
    if (t.type !== 'ident' || !this.atLineStart(t)) return false;
    const n1 = this.peek(1).value;
    return (
      n1 === '::=' ||
      n1 === 'MACRO' ||
      VALUE_MACROS.has(n1) ||
      (n1 === 'OBJECT' && this.peek(2).value === 'IDENTIFIER' && this.peek(3).value === '::=')
    );
  }

  private parseImports(): ImportClause[] {
    const imports: ImportClause[] = [];
    while (!this.eof && !this.accept(';')) {
      const clauseStart = this.pos;
      const symbols: string[] = [];
      while (!this.is('FROM')) {
        const t = this.peek();
        if (t.type === 'ident') symbols.push(t.value);
        else if (t.value !== ',') {
          // Not an import list any more (probably a missing ';').
          this.pos = clauseStart;
          this.diag('warning', 'IMPORTS sem ";" final', t.line);
          return imports;
        }
        this.next();
      }
      this.expect('FROM');
      const module = this.expectIdent().value;
      if (this.is('{')) this.skipBalanced('{', '}');
      imports.push({ module, symbols });
      // A missing ';' followed directly by the first assignment.
      if (this.looksLikeAssignment()) {
        this.diag('warning', 'IMPORTS sem ";" final', this.peek().line);
        break;
      }
    }
    return imports;
  }

  // ---- assignments ---------------------------------------------------------

  private parseAssignment(mod: ParsedModule): void {
    const nameTok = this.expectIdent();
    const name = nameTok.value;
    const t = this.peek();

    if (t.value === 'MACRO') {
      this.next();
      this.expect('::=');
      this.expect('BEGIN');
      while (!this.eof && !this.accept('END')) this.next();
      mod.macros.push(name);
      return;
    }

    if (t.value === '::=') {
      this.next();
      mod.types.push(this.parseTypeAssignment(name, nameTok.line));
      return;
    }

    if (t.value === 'OBJECT' && this.is('IDENTIFIER', 1)) {
      this.next();
      this.next();
      this.expect('::=');
      mod.objects.push({ name, module: mod.name, macro: 'OBJECT IDENTIFIER', oid: this.parseOidValue(), line: nameTok.line });
      return;
    }

    if (t.type === 'ident' && VALUE_MACROS.has(t.value)) {
      this.next();
      mod.objects.push(this.parseMacroValue(name, t.value as MacroKind, nameTok.line));
      return;
    }

    // Something we do not model (a value of another type or an unknown macro):
    // skip to its value and carry on.
    this.diag('warning', `definição ignorada: "${name}" (${describe(t)})`, nameTok.line);
    while (!this.eof && !this.is('::=') && !this.is('END')) this.next();
    if (this.accept('::=')) {
      if (this.is('{')) this.skipBalanced('{', '}');
      else this.next();
    }
  }

  private parseTypeAssignment(name: string, line: number): TypeDef {
    if (!this.accept('TEXTUAL-CONVENTION')) {
      return { name, module: this.mod!.name, line, isTextualConvention: false, syntax: this.parseSyntax() };
    }
    const tc: Partial<TypeDef> = { name, module: this.mod!.name, line, isTextualConvention: true };
    while (!this.eof) {
      const kw = this.next();
      switch (kw.value) {
        case 'DISPLAY-HINT':
          tc.displayHint = this.expectString();
          break;
        case 'STATUS':
          tc.status = this.expectIdent().value;
          break;
        case 'DESCRIPTION':
          tc.description = cleanText(this.expectString());
          break;
        case 'REFERENCE':
          tc.reference = cleanText(this.expectString());
          break;
        case 'SYNTAX':
          // SYNTAX is always the last clause of a TEXTUAL-CONVENTION.
          tc.syntax = this.parseSyntax();
          return tc as TypeDef;
        default:
          this.pos--;
          this.fail(`cláusula inesperada em TEXTUAL-CONVENTION: ${describe(kw)}`);
      }
    }
    this.fail('TEXTUAL-CONVENTION sem SYNTAX');
  }

  private parseOidValue(): OidComponent[] {
    this.expect('{');
    const comps: OidComponent[] = [];
    while (!this.accept('}')) {
      const t = this.next();
      if (t.type === 'number') {
        comps.push({ number: Number(t.value) });
      } else if (t.type === 'ident') {
        if (this.accept('(')) {
          comps.push({ name: t.value, number: this.expectNumber() });
          this.expect(')');
        } else {
          comps.push({ name: t.value });
        }
      } else {
        this.pos--;
        this.fail(`valor de OID inválido: ${describe(t)}`);
      }
    }
    if (!comps.length) this.fail('OID vazio');
    return comps;
  }

  private parseMacroValue(name: string, macro: MacroKind, line: number): ObjectDef {
    const def: ObjectDef = { name, module: this.mod!.name, macro, oid: [], line };

    while (!this.eof && !this.is('::=')) {
      const kw = this.next();
      switch (kw.value) {
        case 'SYNTAX':
          def.syntax = this.parseSyntax();
          break;
        case 'UNITS':
          def.units = this.expectString();
          break;
        case 'MAX-ACCESS':
        case 'ACCESS':
          def.access = this.expectIdent().value;
          break;
        case 'STATUS':
          def.status = this.expectIdent().value;
          break;
        case 'DESCRIPTION':
          def.description = cleanText(this.expectString());
          break;
        case 'REFERENCE':
          def.reference = cleanText(this.expectString());
          break;
        case 'INDEX':
          def.index = this.parseIndex();
          break;
        case 'AUGMENTS':
          this.expect('{');
          def.augments = this.expectIdent().value;
          this.expect('}');
          break;
        case 'DEFVAL': {
          const open = this.pos;
          this.skipBalanced('{', '}');
          const inner = this.textBetween(open, this.pos - 1);
          def.defval = inner.slice(1, -1).trim();
          break;
        }
        case 'OBJECTS':
        case 'VARIABLES':
          def.objects = this.parseNameList();
          break;
        case 'NOTIFICATIONS':
          def.notifications = this.parseNameList();
          break;
        case 'ENTERPRISE':
          if (this.is('{')) {
            const comps = this.parseOidValue();
            def.enterprise = comps[comps.length - 1].name ?? String(comps[comps.length - 1].number);
          } else {
            def.enterprise = this.expectIdent().value;
          }
          break;
        case 'LAST-UPDATED':
          def.lastUpdated = this.expectString();
          break;
        case 'ORGANIZATION':
          def.organization = cleanText(this.expectString());
          break;
        case 'CONTACT-INFO':
          def.contactInfo = cleanText(this.expectString());
          break;
        case 'PRODUCT-RELEASE':
          def.productRelease = cleanText(this.expectString());
          break;
        case 'REVISION': {
          const date = this.expectString();
          this.expect('DESCRIPTION');
          (def.revisions ??= []).push({ date, description: cleanText(this.expectString()) });
          break;
        }
        case 'MODULE':
          (def.compliance ??= []).push(this.parseComplianceModule());
          break;
        case 'SUPPORTS':
          // AGENT-CAPABILITIES details are not modelled.
          while (!this.eof && !this.is('::=')) this.next();
          break;
        default:
          this.pos--;
          this.fail(`cláusula inesperada em ${macro}: ${describe(kw)}`);
      }
    }

    this.expect('::=');
    if (macro === 'TRAP-TYPE') {
      def.trapNumber = this.expectNumber();
    } else {
      def.oid = this.parseOidValue();
    }
    return def;
  }

  private parseIndex(): IndexItem[] {
    this.expect('{');
    const items: IndexItem[] = [];
    while (!this.accept('}')) {
      if (this.accept(',')) continue;
      const implied = this.accept('IMPLIED');
      // SMIv1 allows type names here (e.g. `INTEGER`, `OCTET STRING`).
      const first = this.expectIdent().value;
      const name = first === 'OCTET' && this.accept('STRING') ? 'OCTET STRING' : first;
      items.push(implied ? { name, implied } : { name });
    }
    return items;
  }

  private parseNameList(): string[] {
    this.expect('{');
    const names: string[] = [];
    while (!this.accept('}')) {
      if (this.accept(',')) continue;
      names.push(this.expectIdent().value);
    }
    return names;
  }

  private parseComplianceModule(): ComplianceModule {
    const cm: ComplianceModule = { mandatoryGroups: [], groups: [], objects: [] };
    const t = this.peek();
    if (t.type === 'ident' && !COMPLIANCE_KEYWORDS.has(t.value) && /^[A-Z]/.test(t.value)) {
      cm.module = this.next().value;
      if (this.is('{')) this.skipBalanced('{', '}');
    }

    while (!this.eof && !this.is('::=') && !this.is('MODULE')) {
      const kw = this.next();
      switch (kw.value) {
        case 'MANDATORY-GROUPS':
          cm.mandatoryGroups = this.parseNameList();
          break;
        case 'GROUP': {
          const group: ComplianceModule['groups'][number] = { name: this.expectIdent().value };
          if (this.accept('DESCRIPTION')) group.description = cleanText(this.expectString());
          cm.groups.push(group);
          break;
        }
        case 'OBJECT': {
          const obj: ComplianceModule['objects'][number] = { name: this.expectIdent().value };
          for (;;) {
            if (this.accept('SYNTAX')) obj.syntax = this.parseSyntax();
            else if (this.accept('WRITE-SYNTAX')) obj.writeSyntax = this.parseSyntax();
            else if (this.accept('MIN-ACCESS')) obj.minAccess = this.expectIdent().value;
            else if (this.accept('DESCRIPTION')) obj.description = cleanText(this.expectString());
            else break;
          }
          cm.objects.push(obj);
          break;
        }
        default:
          this.pos--;
          this.fail(`cláusula inesperada em MODULE-COMPLIANCE: ${describe(kw)}`);
      }
    }
    return cm;
  }

  // ---- SYNTAX --------------------------------------------------------------

  parseSyntax(): SyntaxSpec {
    const first = this.pos;
    if (this.is('[')) this.skipBalanced('[', ']');
    if (!this.accept('IMPLICIT')) this.accept('EXPLICIT');

    const spec: SyntaxSpec = { raw: '', base: '' };
    if (this.is('OCTET') && this.is('STRING', 1)) {
      this.pos += 2;
      spec.base = 'OCTET STRING';
    } else if (this.is('OBJECT') && this.is('IDENTIFIER', 1)) {
      this.pos += 2;
      spec.base = 'OBJECT IDENTIFIER';
    } else if (this.is('BIT') && this.is('STRING', 1)) {
      this.pos += 2;
      spec.base = 'BIT STRING';
    } else if (this.accept('SEQUENCE')) {
      if (this.accept('OF')) {
        spec.base = 'SEQUENCE OF';
        spec.sequenceOf = this.parseSyntax().base;
      } else {
        spec.base = 'SEQUENCE';
        spec.sequence = this.parseSequenceFields();
      }
    } else if (this.accept('CHOICE')) {
      spec.base = 'CHOICE';
      this.skipBalanced('{', '}');
    } else {
      spec.base = this.expectIdent().value;
      // Qualified reference: Module.Type
      if (this.is('.') && this.peek(1).type === 'ident') {
        this.next();
        spec.base = this.next().value;
      }
    }

    if (this.is('{') && spec.base !== 'SEQUENCE') spec.enums = this.parseNamedNumbers();
    if (this.is('(')) this.parseConstraint(spec);

    spec.raw = this.textBetween(first, this.pos - 1);
    return spec;
  }

  private parseSequenceFields(): { name: string; type: string }[] {
    this.expect('{');
    const fields: { name: string; type: string }[] = [];
    while (!this.accept('}')) {
      if (this.accept(',')) continue;
      const name = this.expectIdent().value;
      fields.push({ name, type: this.parseSyntax().raw });
    }
    return fields;
  }

  private parseNamedNumbers(): NamedNumber[] {
    this.expect('{');
    const items: NamedNumber[] = [];
    while (!this.accept('}')) {
      if (this.accept(',')) continue;
      const name = this.expectIdent().value;
      this.expect('(');
      const value = this.expectNumber();
      this.expect(')');
      items.push({ name, value });
    }
    return items;
  }

  private parseConstraint(spec: SyntaxSpec): void {
    const start = this.pos;
    try {
      this.expect('(');
      if (this.accept('SIZE')) {
        this.expect('(');
        spec.sizes = this.parseRangeList();
        this.expect(')');
      } else {
        spec.ranges = this.parseRangeList();
      }
      this.expect(')');
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      // Unusual constraint: keep it only in the raw text.
      this.pos = start;
      delete spec.sizes;
      delete spec.ranges;
      this.skipBalanced('(', ')');
    }
  }

  private parseRangeList(): Range[] {
    const ranges: Range[] = [];
    do {
      const min = this.parseRangeValue();
      const max = this.accept('..') ? this.parseRangeValue() : min;
      ranges.push({ min, max });
    } while (this.accept('|'));
    return ranges;
  }

  private parseRangeValue(): string {
    const t = this.peek();
    if (t.type === 'number' || t.type === 'hex' || t.type === 'bin' || t.value === 'MIN' || t.value === 'MAX') {
      this.next();
      return this.src.slice(t.start, t.end);
    }
    this.fail(`valor de faixa inválido: ${describe(t)}`);
  }
}

function describe(t: Token): string {
  if (t.type === 'eof') return 'fim do arquivo';
  if (t.type === 'string') return 'texto entre aspas';
  return `"${t.value}"`;
}
