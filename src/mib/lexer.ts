// Tokenizer for ASN.1 / SMI module text.
//
// Comments follow the ASN.1 rule: `--` starts a comment that ends at the next
// `--` or at the end of the line, whichever comes first. `--` inside a quoted
// string is not a comment.

export type TokenType = 'ident' | 'number' | 'string' | 'hex' | 'bin' | 'symbol' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  /** Offsets into the source text, used to recover the original spelling. */
  start: number;
  end: number;
}

const SYMBOLS = ['::=', '..', '{', '}', '(', ')', '[', ']', ',', ';', '|', '.', '<', '>', '@', '!', '='];

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

function isIdentChar(c: string): boolean {
  return isIdentStart(c) || (c >= '0' && c <= '9') || c === '_';
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;

  while (i < n) {
    const c = src[i];

    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      i++;
      continue;
    }

    // Comment: ends at the next `--` or end of line.
    if (c === '-' && src[i + 1] === '-') {
      i += 2;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '-' && src[i + 1] === '-') {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    const start = i;

    if (c === '"') {
      const startLine = line;
      i++;
      let value = '';
      while (i < n) {
        if (src[i] === '"') {
          // ASN.1 escapes a quote inside a string by doubling it.
          if (src[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          break;
        }
        if (src[i] === '\n') line++;
        value += src[i];
        i++;
      }
      i++; // closing quote (or EOF)
      tokens.push({ type: 'string', value, line: startLine, start, end: i });
      continue;
    }

    if (c === "'") {
      const close = src.indexOf("'", i + 1);
      if (close !== -1) {
        const body = src.slice(i + 1, close).replace(/\s+/g, '');
        const suffix = src[close + 1]?.toUpperCase();
        if (suffix === 'H' || suffix === 'B') {
          for (let k = i; k < close; k++) if (src[k] === '\n') line++;
          i = close + 2;
          tokens.push({ type: suffix === 'H' ? 'hex' : 'bin', value: body, line, start, end: i });
          continue;
        }
      }
      // Stray quote: skip it.
      i++;
      continue;
    }

    if (isDigit(c) || (c === '-' && isDigit(src[i + 1] ?? ''))) {
      i++;
      while (i < n && isDigit(src[i])) i++;
      tokens.push({ type: 'number', value: src.slice(start, i), line, start, end: i });
      continue;
    }

    if (isIdentStart(c)) {
      i++;
      while (i < n) {
        const d = src[i];
        if (isIdentChar(d)) {
          i++;
        } else if (d === '-' && src[i + 1] !== '-' && isIdentChar(src[i + 1] ?? '')) {
          // A hyphen is part of an identifier only when it is followed by
          // another identifier character (and is not the start of a comment).
          i++;
        } else {
          break;
        }
      }
      tokens.push({ type: 'ident', value: src.slice(start, i), line, start, end: i });
      continue;
    }

    const sym = SYMBOLS.find((s) => src.startsWith(s, i));
    if (sym) {
      i += sym.length;
      tokens.push({ type: 'symbol', value: sym, line, start, end: i });
      continue;
    }

    // Unknown character: ignore.
    i++;
  }

  tokens.push({ type: 'eof', value: '', line, start: n, end: n });
  return tokens;
}
