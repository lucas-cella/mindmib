import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/mib/lexer';

const values = (src: string) => tokenize(src).filter((t) => t.type !== 'eof').map((t) => t.value);

describe('lexer', () => {
  it('ignores a comment running to the end of the line', () => {
    expect(values('a -- comment ::= { x }\nb')).toEqual(['a', 'b']);
  });

  it('ends an inline comment at the next "--"', () => {
    expect(values('a -- inline -- b')).toEqual(['a', 'b']);
  });

  it('treats separator lines made of dashes as comments', () => {
    expect(values('------------------------------\na\n---------------------------------- x')).toEqual(['a']);
  });

  it('does not see comments inside strings', () => {
    const toks = tokenize('DESCRIPTION "has -- dashes\n  and lines" x');
    expect(toks[1]).toMatchObject({ type: 'string', value: 'has -- dashes\n  and lines', line: 1 });
    expect(toks[2]).toMatchObject({ value: 'x', line: 2 });
  });

  it('keeps hyphens inside identifiers but not a trailing comment', () => {
    expect(values('mib-2 snmpV2-MIB a--b')).toEqual(['mib-2', 'snmpV2-MIB', 'a']);
  });

  it('tokenises symbols, ranges and negative numbers', () => {
    expect(values('x ::= INTEGER (-2147483648..2147483647)')).toEqual([
      'x', '::=', 'INTEGER', '(', '-2147483648', '..', '2147483647', ')',
    ]);
  });

  it('reads hex and binary strings', () => {
    const toks = tokenize("'00FF'H '0101'B");
    expect(toks.slice(0, 2).map((t) => [t.type, t.value])).toEqual([['hex', '00FF'], ['bin', '0101']]);
  });

  it('tracks line numbers', () => {
    const toks = tokenize('a\n\n  b -- c\nd');
    expect(toks.slice(0, 3).map((t) => t.line)).toEqual([1, 3, 4]);
  });
});
