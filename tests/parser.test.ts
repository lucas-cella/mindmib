import { describe, expect, it } from 'vitest';
import { cleanText, parseMib } from '../src/mib/parser';
import { BUILTIN_FILES } from '../src/mib/builtin';
import { TEST_MIB } from './fixtures';

const parseOne = (text: string) => {
  const { modules, diagnostics } = parseMib(text, 'test.mib');
  return { mod: modules[0], diagnostics };
};
const obj = (text: string, name: string) => parseOne(text).mod.objects.find((o) => o.name === name)!;

describe('parser: built-in MIBs', () => {
  for (const file of BUILTIN_FILES) {
    it(`parses ${file.name} without errors`, () => {
      const { modules, diagnostics } = parseMib(file.text, file.name);
      expect(modules).toHaveLength(1);
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    });
  }

  it('reads IMPORTS', () => {
    const ifMib = BUILTIN_FILES.find((f) => f.name === 'IF-MIB.txt')!;
    const { modules } = parseMib(ifMib.text);
    const smi = modules[0].imports.find((i) => i.module === 'SNMPv2-SMI')!;
    expect(smi.symbols).toContain('mib-2');
    expect(modules[0].imports.map((i) => i.module)).toEqual(['SNMPv2-SMI', 'SNMPv2-TC', 'SNMPv2-CONF', 'SNMPv2-MIB', 'IANAifType-MIB']);
  });

  it('skips MACRO bodies', () => {
    const smi = BUILTIN_FILES.find((f) => f.name === 'SNMPv2-SMI.txt')!;
    const { modules } = parseMib(smi.text);
    expect(modules[0].macros).toEqual(expect.arrayContaining(['MODULE-IDENTITY', 'OBJECT-TYPE', 'NOTIFICATION-TYPE']));
    expect(modules[0].types.map((t) => t.name)).toEqual(expect.arrayContaining(['Integer32', 'Counter64', 'IpAddress']));
  });
});

describe('parser: macros', () => {
  it('parses the whole test module cleanly', () => {
    const { mod, diagnostics } = parseOne(TEST_MIB);
    expect(diagnostics).toEqual([]);
    expect(mod.name).toBe('TEST-MIB');
    expect(mod.objects).toHaveLength(19);
  });

  it('MODULE-IDENTITY', () => {
    const d = obj(TEST_MIB, 'testMIB');
    expect(d).toMatchObject({
      macro: 'MODULE-IDENTITY',
      lastUpdated: '202601010000Z',
      organization: 'Test Org',
      revisions: [{ date: '202601010000Z', description: 'Initial version.' }],
      oid: [{ name: 'enterprises' }, { number: 99999 }],
    });
  });

  it('OBJECT-TYPE with range, units and DEFVAL', () => {
    const d = obj(TEST_MIB, 'testScalar');
    expect(d.syntax).toMatchObject({ base: 'Integer32', raw: 'Integer32 (0..100 | 200)', ranges: [{ min: '0', max: '100' }, { min: '200', max: '200' }] });
    expect(d).toMatchObject({ units: 'percent', access: 'read-write', status: 'current', defval: '42' });
    expect(d.description).toBe('A scalar -- with dashes inside the text.');
  });

  it('INDEX with IMPLIED, AUGMENTS, SIZE and BITS', () => {
    expect(obj(TEST_MIB, 'testEntry').index).toEqual([{ name: 'testIndex' }, { name: 'testName', implied: true }]);
    expect(obj(TEST_MIB, 'testExtEntry').augments).toBe('testEntry');
    expect(obj(TEST_MIB, 'testName').syntax).toMatchObject({ base: 'DisplayString', sizes: [{ min: '0', max: '32' }] });
    expect(obj(TEST_MIB, 'testFlags').syntax).toMatchObject({ base: 'BITS', enums: [{ name: 'up', value: 0 }, { name: 'down', value: 1 }] });
    expect(obj(TEST_MIB, 'testFlags').defval).toBe('{ up }');
    expect(obj(TEST_MIB, 'testTable').syntax).toMatchObject({ base: 'SEQUENCE OF', sequenceOf: 'TestEntry' });
  });

  it('TEXTUAL-CONVENTION and SEQUENCE types', () => {
    const { mod } = parseOne(TEST_MIB);
    const tc = mod.types.find((t) => t.name === 'TestLevel')!;
    expect(tc).toMatchObject({ isTextualConvention: true, displayHint: 'd', status: 'current' });
    expect(tc.syntax.enums).toEqual([{ name: 'low', value: 1 }, { name: 'medium', value: 2 }, { name: 'high', value: 3 }]);
    const seq = mod.types.find((t) => t.name === 'TestEntry')!;
    expect(seq.syntax.sequence?.map((f) => f.name)).toEqual(['testIndex', 'testName', 'testStatus']);
  });

  it('notifications, traps and groups', () => {
    expect(obj(TEST_MIB, 'testEvent').objects).toEqual(['testScalar', 'testLevel']);
    expect(obj(TEST_MIB, 'testTrap')).toMatchObject({ macro: 'TRAP-TYPE', enterprise: 'testMIB', trapNumber: 7, objects: ['testScalar'] });
    expect(obj(TEST_MIB, 'testNotifGroup').notifications).toEqual(['testEvent']);
  });

  it('MODULE-COMPLIANCE keeps nested descriptions apart', () => {
    const d = obj(TEST_MIB, 'testCompliance');
    expect(d.description).toBe('Compliance.');
    expect(d.compliance).toEqual([
      {
        mandatoryGroups: ['testGroup'],
        groups: [{ name: 'testNotifGroup', description: 'Optional notifications.' }],
        objects: [{ name: 'testScalar', minAccess: 'read-only', description: 'Write not required.' }],
      },
    ]);
  });

  it('parses SMIv1 OBJECT-TYPE (ACCESS / mandatory)', () => {
    const rfc1213 = BUILTIN_FILES.find((f) => f.name === 'RFC1213-MIB.txt')!;
    const d = obj(rfc1213.text, 'ifOperStatus');
    expect(d).toMatchObject({ access: 'read-only', status: 'mandatory' });
    expect(d.syntax?.enums?.[0]).toEqual({ name: 'up', value: 1 });
  });
});

describe('parser: robustness', () => {
  it('recovers after a broken definition', () => {
    const text = `
BROKEN-MIB DEFINITIONS ::= BEGIN
a OBJECT IDENTIFIER ::= { iso 3 }
bad OBJECT-TYPE
    SYNTAX INTEGER
    WHATEVER 12
    ::= { a 1 }
good OBJECT IDENTIFIER ::= { a 2 }
END`;
    const { mod, diagnostics } = parseOne(text);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', line: 6, module: 'BROKEN-MIB' });
    expect(mod.objects.map((o) => o.name)).toEqual(['a', 'good']);
  });

  it('accepts several modules in one file and text before the header', () => {
    const text = `Some RFC prose here.\nA DEFINITIONS ::= BEGIN x OBJECT IDENTIFIER ::= { iso 9 } END\nB DEFINITIONS ::= BEGIN y OBJECT IDENTIFIER ::= { x 1 } END`;
    const { modules } = parseMib(text);
    expect(modules.map((m) => m.name)).toEqual(['A', 'B']);
  });

  it('reports a file without modules', () => {
    expect(parseMib('just text').diagnostics[0].severity).toBe('error');
  });

  it('strips the common indentation of descriptions', () => {
    expect(cleanText('First line\n        second\n          third\n    ')).toBe('First line\nsecond\n  third');
  });
});

describe('parser: SYNTAX text', () => {
  it('drops comments from the raw SYNTAX', () => {
    const text = `C-MIB DEFINITIONS ::= BEGIN
T ::= INTEGER { a(1), -- first
                b(2)  -- second
              }
END`;
    expect(parseOne(text).mod.types[0].syntax.raw).toBe('INTEGER { a(1), b(2) }');
  });
});
