// Search box: by object name (prefix first, then substring) or numeric OID.

import type { MibNode, MibTree } from '../mib';
import { h, icon } from './dom';

const MAX_RESULTS = 50;

interface Result {
  node: MibNode;
  /** Name under which the node matched (may be an alias). */
  name: string;
  note?: string;
}

interface IndexEntry {
  node: MibNode;
  name: string;
  lower: string;
}

export class Search {
  private index: IndexEntry[] = [];
  private tree!: MibTree;
  private results: Result[] = [];
  private active = -1;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;

  constructor(
    container: HTMLElement,
    private readonly onPick: (node: MibNode) => void,
  ) {
    this.input = h('input', {
      type: 'search',
      class: 'search-input',
      placeholder: 'Buscar nome ou OID  (/)',
      'aria-label': 'Buscar nome ou OID',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    this.list = h('ul', { class: 'search-results', role: 'listbox' });
    container.append(h('div', { class: 'search' }, icon('search', 16), this.input, this.list));

    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('focus', () => this.update());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => setTimeout(() => this.hide(), 150));
    document.addEventListener('keydown', (e) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.key === '/' && !typing) || (e.key === 'k' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        this.input.focus();
        this.input.select();
      }
    });
  }

  setTree(tree: MibTree): void {
    this.tree = tree;
    this.index = [];
    for (const [name, nodes] of tree.byName) {
      for (const node of nodes) this.index.push({ node, name, lower: name.toLowerCase() });
    }
    if (document.activeElement === this.input) this.update();
  }

  private query(q: string): Result[] {
    const oidQuery = q.replace(/^\.|\.$/g, '');
    if (/^\d+(\.\d+)*$/.test(oidQuery)) return this.queryOid(oidQuery);

    const lower = q.toLowerCase();
    const scored: { r: Result; score: number }[] = [];
    for (const e of this.index) {
      const at = e.lower.indexOf(lower);
      if (at < 0) continue;
      const score = e.lower === lower ? 0 : at === 0 ? 1 : 2;
      scored.push({ r: { node: e.node, name: e.name, note: e.name !== e.node.name ? `alias de ${e.node.name}` : undefined }, score });
    }
    scored.sort((a, b) => a.score - b.score || a.r.name.length - b.r.name.length || a.r.name.localeCompare(b.r.name));
    return scored.slice(0, MAX_RESULTS).map((s) => s.r);
  }

  private queryOid(oid: string): Result[] {
    const out: Result[] = [];
    const exact = this.tree.byOid.get(oid);
    if (exact) {
      out.push({ node: exact, name: exact.name || String(exact.arc) });
    } else {
      // Closest known ancestor, e.g. for an instance OID like sysName.0.
      const parts = oid.split('.');
      while (parts.length > 1) {
        parts.pop();
        const anc = this.tree.byOid.get(parts.join('.'));
        if (anc) {
          out.push({ node: anc, name: anc.name || String(anc.arc), note: 'ancestral mais próximo' });
          break;
        }
      }
    }
    const prefix = oid + '.';
    const below: MibNode[] = [];
    for (const [key, node] of this.tree.byOid) {
      if (key.startsWith(prefix) && node.name) below.push(node);
    }
    below.sort((a, b) => a.oid.length - b.oid.length || compareOid(a.oid, b.oid));
    for (const node of below) {
      if (out.length >= MAX_RESULTS) break;
      out.push({ node, name: node.name });
    }
    return out;
  }

  private update(): void {
    const q = this.input.value.trim();
    this.results = q ? this.query(q) : [];
    this.active = this.results.length ? 0 : -1;
    this.renderList(q);
  }

  private renderList(q: string): void {
    if (!q) return this.hide();
    const items = this.results.map((r, i) =>
      h(
        'li',
        {
          class: i === this.active ? 'active' : '',
          role: 'option',
          onMousedown: (e: MouseEvent) => {
            e.preventDefault();
            this.pick(i);
          },
          onMousemove: () => this.setActive(i),
        },
        h('span', { class: `kind-dot kind-${r.node.kind}` }),
        h('span', { class: 'result-name' }, highlight(r.name, q)),
        h('span', { class: 'result-meta' }, r.note ?? r.node.def?.module ?? ''),
        h('code', { class: 'result-oid' }, r.node.oidStr),
      ),
    );
    if (!items.length) items.push(h('li', { class: 'empty' }, 'Nada encontrado'));
    this.list.replaceChildren(...items);
    this.list.classList.add('open');
  }

  private hide(): void {
    this.list.classList.remove('open');
  }

  private setActive(i: number): void {
    if (i === this.active) return;
    this.list.children[this.active]?.classList.remove('active');
    this.active = i;
    const li = this.list.children[i];
    li?.classList.add('active');
    li?.scrollIntoView({ block: 'nearest' });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' && this.results.length) {
      e.preventDefault();
      this.setActive((this.active + 1) % this.results.length);
    } else if (e.key === 'ArrowUp' && this.results.length) {
      e.preventDefault();
      this.setActive((this.active - 1 + this.results.length) % this.results.length);
    } else if (e.key === 'Enter' && this.active >= 0) {
      e.preventDefault();
      this.pick(this.active);
    } else if (e.key === 'Escape') {
      this.hide();
      this.input.blur();
    }
  }

  private pick(i: number): void {
    const r = this.results[i];
    if (!r) return;
    this.input.value = '';
    this.hide();
    this.input.blur();
    this.onPick(r.node);
  }
}

function highlight(name: string, q: string): (string | HTMLElement)[] {
  const at = name.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0 || !q) return [name];
  return [name.slice(0, at), h('mark', null, name.slice(at, at + q.length)), name.slice(at + q.length)];
}

function compareOid(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
