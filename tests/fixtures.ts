// A compact module exercising every macro the parser supports.
export const TEST_MIB = `
TEST-MIB DEFINITIONS ::= BEGIN

IMPORTS
    MODULE-IDENTITY, OBJECT-TYPE, NOTIFICATION-TYPE, OBJECT-IDENTITY,
    Integer32, enterprises                        FROM SNMPv2-SMI
    TEXTUAL-CONVENTION, DisplayString, RowStatus  FROM SNMPv2-TC
    OBJECT-GROUP, NOTIFICATION-GROUP,
    MODULE-COMPLIANCE                             FROM SNMPv2-CONF
    TRAP-TYPE                                     FROM RFC-1215;

testMIB MODULE-IDENTITY
    LAST-UPDATED "202601010000Z"
    ORGANIZATION "Test Org"
    CONTACT-INFO "nobody@example.com"
    DESCRIPTION  "A test module."
    REVISION     "202601010000Z"
    DESCRIPTION  "Initial version."
    ::= { enterprises 99999 }

testObjects  OBJECT IDENTIFIER ::= { testMIB 1 }  -- objects
testNotifs   OBJECT IDENTIFIER ::= { testMIB 0 }
testConf     OBJECT IDENTIFIER ::= { testMIB 2 }

TestLevel ::= TEXTUAL-CONVENTION
    DISPLAY-HINT "d"
    STATUS       current
    DESCRIPTION  "A level."
    SYNTAX       INTEGER { low(1), medium(2), high(3) }

testIdentity OBJECT-IDENTITY
    STATUS      current
    DESCRIPTION "An identity."
    ::= { testObjects 9 }

testScalar OBJECT-TYPE
    SYNTAX      Integer32 (0..100 | 200)
    UNITS       "percent"
    MAX-ACCESS  read-write
    STATUS      current
    DESCRIPTION "A scalar -- with dashes inside the text."
    DEFVAL      { 42 }
    ::= { testObjects 1 }

testLevel OBJECT-TYPE
    SYNTAX      TestLevel
    MAX-ACCESS  read-only
    STATUS      current
    DESCRIPTION "Level."
    REFERENCE   "RFC 0000"
    ::= { testObjects 2 }

testTable OBJECT-TYPE
    SYNTAX      SEQUENCE OF TestEntry
    MAX-ACCESS  not-accessible
    STATUS      current
    DESCRIPTION "A table."
    ::= { testObjects 3 }

testEntry OBJECT-TYPE
    SYNTAX      TestEntry
    MAX-ACCESS  not-accessible
    STATUS      current
    DESCRIPTION "A row."
    INDEX       { testIndex, IMPLIED testName }
    ::= { testTable 1 }

TestEntry ::= SEQUENCE {
    testIndex   Integer32,
    testName    DisplayString,
    testStatus  RowStatus
}

testIndex OBJECT-TYPE
    SYNTAX      Integer32 (1..2147483647)
    MAX-ACCESS  not-accessible
    STATUS      current
    DESCRIPTION "Index."
    ::= { testEntry 1 }

testName OBJECT-TYPE
    SYNTAX      DisplayString (SIZE (0..32))
    MAX-ACCESS  read-create
    STATUS      current
    DESCRIPTION "Name."
    DEFVAL      { "" }
    ::= { testEntry 2 }

testStatus OBJECT-TYPE
    SYNTAX      RowStatus
    MAX-ACCESS  read-create
    STATUS      current
    DESCRIPTION "Status."
    ::= { testEntry 3 }

testExtEntry OBJECT-TYPE
    SYNTAX      TestExtEntry
    MAX-ACCESS  not-accessible
    STATUS      current
    DESCRIPTION "Extension."
    AUGMENTS    { testEntry }
    ::= { testObjects 4 }

testFlags OBJECT-TYPE
    SYNTAX      BITS { up(0), down(1) }
    MAX-ACCESS  read-only
    STATUS      current
    DESCRIPTION "Flags."
    DEFVAL      { { up } }
    ::= { testObjects 5 }

testEvent NOTIFICATION-TYPE
    OBJECTS     { testScalar, testLevel }
    STATUS      current
    DESCRIPTION "Something happened."
    ::= { testNotifs 1 }

testTrap TRAP-TYPE
    ENTERPRISE  testMIB
    VARIABLES   { testScalar }
    DESCRIPTION "SMIv1 trap."
    ::= 7

testGroup OBJECT-GROUP
    OBJECTS     { testScalar, testLevel, testName, testStatus }
    STATUS      current
    DESCRIPTION "Objects."
    ::= { testConf 1 }

testNotifGroup NOTIFICATION-GROUP
    NOTIFICATIONS { testEvent }
    STATUS        current
    DESCRIPTION   "Notifications."
    ::= { testConf 2 }

testCompliance MODULE-COMPLIANCE
    STATUS      current
    DESCRIPTION "Compliance."
    MODULE  -- this module
        MANDATORY-GROUPS { testGroup }
        GROUP       testNotifGroup
        DESCRIPTION "Optional notifications."
        OBJECT      testScalar
        MIN-ACCESS  read-only
        DESCRIPTION "Write not required."
    ::= { testConf 3 }

END
`;
