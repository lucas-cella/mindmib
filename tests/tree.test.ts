import { describe, expect, it } from 'vitest';
import { loadMibs, namedOid, resolveSyntax } from '../src/mib';
import { BUILTIN_FILES } from '../src/mib/builtin';
import { TEST_MIB } from './fixtures';

const builtin = loadMibs(BUILTIN_FILES);
const node = (tree: typeof builtin, name: string) => tree.byName.get(name)![0];

describe('tree: built-in MIBs', () => {
  it('resolves everything without missing imports', () => {
    expect(builtin.missingImports).toEqual([]);
    expect(builtin.unresolved).toEqual([]);
    expect(builtin.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('always has iso.org.dod.internet', () => {
    expect(builtin.byOid.get('1.3.6.1')?.name).toBe('internet');
    expect(builtin.byOid.get('1')?.name).toBe('iso');
  });

  it('computes full numeric OIDs', () => {
    expect(node(builtin, 'sysName').oidStr).toBe('1.3.6.1.2.1.1.5');
    expect(node(builtin, 'ifInOctets').oidStr).toBe('1.3.6.1.2.1.2.2.1.10');
    expect(node(builtin, 'ifHCInOctets').oidStr).toBe('1.3.6.1.2.1.31.1.1.1.6');
    expect(node(builtin, 'linkDown').oidStr).toBe('1.3.6.1.6.3.1.1.5.3');
  });

  it('builds the named OID', () => {
    expect(namedOid(node(builtin, 'sysName'))).toBe('iso.org.dod.internet.mgmt.mib-2.system.sysName');
  });

  it('keeps children sorted by arc', () => {
    const arcs = node(builtin, 'system').children.map((c) => c.arc);
    expect(arcs).toEqual([...arcs].sort((a, b) => a - b));
  });

  it('classifies node kinds', () => {
    expect(node(builtin, 'system').kind).toBe('branch');
    expect(node(builtin, 'sysName').kind).toBe('scalar');
    expect(node(builtin, 'ifTable').kind).toBe('table');
    expect(node(builtin, 'ifEntry').kind).toBe('entry');
    expect(node(builtin, 'ifDescr').kind).toBe('column');
    expect(node(builtin, 'ifXEntry').kind).toBe('entry'); // AUGMENTS
    expect(node(builtin, 'coldStart').kind).toBe('notification');
    expect(node(builtin, 'ifMIB').kind).toBe('module');
    expect(node(builtin, 'ifGeneralInformationGroup').kind).toBe('group');
    expect(node(builtin, 'ifCompliance3').kind).toBe('compliance');
  });

  it('prefers the SMIv2 definition and keeps the SMIv1 one as alias', () => {
    const sysDescr = node(builtin, 'sysDescr');
    expect(sysDescr.def?.module).toBe('SNMPv2-MIB');
    expect(sysDescr.aliases.map((a) => a.module)).toContain('RFC1213-MIB');
  });
});

describe('syntax resolution', () => {
  it('resolves a textual convention to its base type', () => {
    const def = node(builtin, 'sysName').def!;
    const r = resolveSyntax(builtin, def.syntax!, def.module);
    expect(r.chain.map((t) => t.name)).toEqual(['DisplayString']);
    expect(r.baseType).toBe('OCTET STRING');
    expect(r.sizes).toEqual([{ min: '0', max: '255' }]);
    expect(r.displayHint).toBe('255a');
  });

  it('finds enumerations in an imported TC', () => {
    const def = node(builtin, 'ifType').def!;
    const r = resolveSyntax(builtin, def.syntax!, def.module);
    expect(r.chain[0].module).toBe('IANAifType-MIB');
    expect(r.enums?.find((e) => e.value === 6)?.name).toBe('ethernetCsmacd');
  });

  it('keeps the declared refinement over the TC constraint', () => {
    const def = node(builtin, 'ifAlias').def!;
    const r = resolveSyntax(builtin, def.syntax!, def.module);
    expect(r.sizes).toEqual([{ min: '0', max: '64' }]);
  });

  it('resolves SMI application types', () => {
    const def = node(builtin, 'ifInOctets').def!;
    const r = resolveSyntax(builtin, def.syntax!, def.module);
    expect(r.baseType).toBe('INTEGER');
    expect(r.ranges).toEqual([{ min: '0', max: '4294967295' }]);
  });
});

describe('tree: user modules', () => {
  const tree = loadMibs([...BUILTIN_FILES, { name: 'test.mib', text: TEST_MIB }]);

  it('resolves imports against the built-ins', () => {
    expect(tree.missingImports).toEqual([]);
    expect(tree.unresolved).toEqual([]);
    expect(node(tree, 'testScalar').oidStr).toBe('1.3.6.1.4.1.99999.1.1');
    expect(node(tree, 'testStatus').kind).toBe('column');
    expect(node(tree, 'testExtEntry').kind).toBe('entry');
  });

  it('places SMIv1 traps under enterprise.0', () => {
    const trap = node(tree, 'testTrap');
    expect(trap.oidStr).toBe('1.3.6.1.4.1.99999.0.7');
    expect(trap.parent?.name).toBe('testNotifs');
  });

  it('reports missing modules without failing', () => {
    const text = `
PARTIAL-MIB DEFINITIONS ::= BEGIN
IMPORTS enterprises FROM SNMPv2-SMI
        vendorRoot  FROM VENDOR-SMI;
ok      OBJECT IDENTIFIER ::= { enterprises 424242 }
child   OBJECT IDENTIFIER ::= { ok 1 }
orphan  OBJECT IDENTIFIER ::= { vendorRoot 5 }
orphan2 OBJECT IDENTIFIER ::= { orphan 1 }
END`;
    const t = loadMibs([...BUILTIN_FILES, { name: 'partial.mib', text }]);
    expect(t.missingImports).toEqual([{ module: 'VENDOR-SMI', requiredBy: ['PARTIAL-MIB'] }]);
    expect(t.unresolved.map((u) => u.name)).toEqual(['orphan', 'orphan2']);
    expect(t.unresolved[0].reason).toContain('VENDOR-SMI');
    expect(node(t, 'child').oidStr).toBe('1.3.6.1.4.1.424242.1');
  });

  it('lets a user module replace a built-in one with the same name', () => {
    const text = `IF-MIB DEFINITIONS ::= BEGIN
IMPORTS mib-2 FROM SNMPv2-SMI;
ifMIB OBJECT IDENTIFIER ::= { mib-2 31 }
onlyHere OBJECT IDENTIFIER ::= { ifMIB 99 }
END`;
    const t = loadMibs([...BUILTIN_FILES, { name: 'my-if.mib', text }]);
    expect(t.modules.get('IF-MIB')?.file).toBe('my-if.mib');
    expect(t.byName.has('onlyHere')).toBe(true);
    expect(t.byName.has('ifXTable')).toBe(false);
  });
});
