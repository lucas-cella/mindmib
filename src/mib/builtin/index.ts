// Base MIBs bundled with the app so the standard tree and the most common
// IMPORTS are always available. Order matters: when two modules define the
// same OID, the first one becomes the primary definition (SMIv2 before SMIv1).

import snmpv2Smi from './SNMPv2-SMI.txt?raw';
import snmpv2Tc from './SNMPv2-TC.txt?raw';
import snmpv2Conf from './SNMPv2-CONF.txt?raw';
import snmpv2Mib from './SNMPv2-MIB.txt?raw';
import ianaIfType from './IANAifType-MIB.txt?raw';
import ifMib from './IF-MIB.txt?raw';
import rfc1155 from './RFC1155-SMI.txt?raw';
import rfc1212 from './RFC-1212.txt?raw';
import rfc1215 from './RFC-1215.txt?raw';
import rfc1213 from './RFC1213-MIB.txt?raw';
import type { SourceFile } from '../index';

export const BUILTIN_FILES: SourceFile[] = [
  { name: 'SNMPv2-SMI.txt', text: snmpv2Smi },
  { name: 'SNMPv2-TC.txt', text: snmpv2Tc },
  { name: 'SNMPv2-CONF.txt', text: snmpv2Conf },
  { name: 'SNMPv2-MIB.txt', text: snmpv2Mib },
  { name: 'IANAifType-MIB.txt', text: ianaIfType },
  { name: 'IF-MIB.txt', text: ifMib },
  { name: 'RFC1155-SMI.txt', text: rfc1155 },
  { name: 'RFC-1212.txt', text: rfc1212 },
  { name: 'RFC-1215.txt', text: rfc1215 },
  { name: 'RFC1213-MIB.txt', text: rfc1213 },
].map((f) => ({ ...f, builtin: true }));
