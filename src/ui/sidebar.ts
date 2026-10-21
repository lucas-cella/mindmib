// Left sidebar with every attribute the MIB defines for the selected node.
// Fields are rendered only when the definition actually has them.

import {
  displayName,
  formatRanges,
  namedOid,
  pathTo,
  resolveSyntax,
  type MibNode,
  type MibTree,
  type ObjectDef,
  type SyntaxSpec,
} from '../mib';
import { append, h, icon, iconButton, type Child } from './dom';
import { KIND_LABEL } from './kinds';

export interface SidebarOptions {
  onNavigate(node: MibNode): void;
  onClose(): void;
}

export class Sidebar {
  private tree!: MibTree;
  private node: MibNode | null = null;
  private readonly body: HTMLElement;

  constructor(
    private readonly el: HTMLElement,
    private readonly opts: SidebarOptions,
  ) {
    this.body = h('div', { class: 'sidebar-body' });
    el.append(
      h('div', { class: 'sidebar-head' }, h('span', { class: 'sidebar-kicker' }, 'Detalhes'), iconButton('close', 'Fechar', () => this.opts.onClose())),
      this.body,
    );
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  setTree(tree: MibTree): void {
    this.tree = tree;
    if (!this.node) return;
    const same = tree.byOid.get(this.node.oidStr);
    if (same) this.show(same);
    else this.close();
  }

  show(node: MibNode): void {
    this.node = node;
    this.body.replaceChildren();
    append(this.body, this.render(node));
    this.body.scrollTop = 0;
    this.el.classList.add('open');
  }

  close(): void {
    this.node = null;
    this.el.classList.remove('open');
  }

  // ---- rendering -----------------------------------------------------------

  private render(node: MibNode): Child[] {
    const def = node.def;
    return [
      this.breadcrumb(node),
      h(
        'header',
        { class: 'detail-title' },
        h('div', { class: 'detail-kind' }, h('span', { class: `kind-dot kind-${node.kind}` }), KIND_LABEL[node.kind], def && h('span', { class: 'muted' }, ` · ${def.macro}`)),
        h('h2', null, displayName(node)),
      ),
      this.oidBlock(node),
      this.fields(node, def),
      def?.syntax && this.syntaxSection(def),
      this.indexSection(def),
      this.columnsSection(node),
      this.listSection('OBJECTS', def?.objects, def),
      this.listSection('NOTIFICATIONS', def?.notifications, def),
      this.complianceSection(def),
      this.textSection('DESCRIPTION', def?.description),
      this.textSection('REFERENCE', def?.reference),
      this.moduleIdentitySection(def),
      this.childrenSection(node),
      node.aliases.length > 0 &&
        section('Também definido em', h('p', { class: 'muted' }, node.aliases.map((a) => `${a.module} (${a.name})`).join(', '))),
    ];
  }

  private breadcrumb(node: MibNode): HTMLElement {
    const path = pathTo(node);
    const items: Child[] = [];
    path.forEach((n, i) => {
      if (i > 0) items.push(h('span', { class: 'crumb-sep' }, '›'));
      items.push(
        i === path.length - 1
          ? h('span', { class: 'crumb current' }, displayName(n))
          : h('button', { class: 'crumb', type: 'button', title: n.oidStr, onClick: () => this.opts.onNavigate(n) }, displayName(n)),
      );
    });
    return h('nav', { class: 'breadcrumb', 'aria-label': 'Caminho' }, items);
  }

  private oidBlock(node: MibNode): HTMLElement {
    return h(
      'div',
      { class: 'oid-block' },
      h('div', { class: 'oid-row' }, h('code', { class: 'oid-num' }, node.oidStr), copyButton(node.oidStr, 'Copiar OID')),
      h('div', { class: 'oid-row' }, h('code', { class: 'oid-named' }, breakAtDots(namedOid(node))), copyButton(namedOid(node), 'Copiar OID com nomes')),
    );
  }

  private fields(node: MibNode, def?: ObjectDef): HTMLElement | null {
    const rows: [string, Child][] = [];
    if (def) rows.push(['Módulo', def.module]);
    if (def?.access) rows.push(['MAX-ACCESS', h('code', null, def.access)]);
    if (def?.status) rows.push(['STATUS', h('span', { class: `status status-${def.status}` }, def.status)]);
    if (def?.units) rows.push(['UNITS', def.units]);
    if (def?.augments) rows.push(['AUGMENTS', this.symbolLink(def.augments, def)]);
    if (def?.defval !== undefined) rows.push(['DEFVAL', h('code', null, def.defval || '""')]);
    if (def?.enterprise) rows.push(['ENTERPRISE', this.symbolLink(def.enterprise, def)]);
    if (def?.trapNumber !== undefined) rows.push(['Trap específica', h('code', null, String(def.trapNumber))]);
    if (!def) rows.push(['Definição', h('span', { class: 'muted' }, node.kind === 'root' ? 'raiz' : 'arco sem definição nas MIBs carregadas')]);
    if (!rows.length) return null;
    return h('dl', { class: 'fields' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
  }

  private syntaxSection(def: ObjectDef): HTMLElement {
    const r = resolveSyntax(this.tree, def.syntax!, def.module);
    const parts: Child[] = [h('pre', { class: 'code' }, syntaxText(def.syntax!))];

    if (r.chain.length) {
      const steps: Child[] = [];
      for (const td of r.chain) {
        steps.push(
          h(
            'div',
            { class: 'chain-step' },
            h('span', { class: 'chain-arrow' }, '→'),
            h('div', null, h('code', null, syntaxText(td.syntax)), h('div', { class: 'muted small' }, `${td.name} · ${td.module}`)),
          ),
        );
      }
      parts.push(h('div', { class: 'chain' }, steps));
    }

    const meta: [string, string][] = [];
    if (r.chain.length) meta.push(['Tipo base', r.baseType]);
    if (r.sizes) meta.push(['Tamanho', formatRanges(r.sizes)]);
    if (r.ranges) meta.push(['Faixa', formatRanges(r.ranges)]);
    if (r.displayHint) meta.push(['DISPLAY-HINT', r.displayHint]);
    if (meta.length) parts.push(h('dl', { class: 'fields compact' }, meta.map(([k, v]) => [h('dt', null, k), h('dd', null, h('code', null, v))])));

    const tc = r.chain.find((t) => t.isTextualConvention && t.description);
    if (tc) {
      parts.push(
        h('details', { class: 'tc-details' }, h('summary', null, `Sobre ${tc.name}`), h('p', { class: 'prose' }, reflow(tc.description!))),
      );
    }

    if (r.enums?.length) {
      parts.push(
        h(
          'table',
          { class: 'enum-table' },
          h('thead', null, h('tr', null, h('th', null, r.baseType === 'BITS' ? 'Bit' : 'Valor'), h('th', null, 'Nome'))),
          h('tbody', null, r.enums.map((e) => h('tr', null, h('td', null, h('code', null, String(e.value))), h('td', null, e.name)))),
        ),
      );
    }
    return section('SYNTAX', parts);
  }

  private indexSection(def?: ObjectDef): HTMLElement | null {
    if (!def?.index?.length) return null;
    return section(
      'INDEX',
      h(
        'ul',
        { class: 'link-list' },
        def.index.map((i) => h('li', null, this.symbolLink(i.name, def), i.implied && h('span', { class: 'tag' }, 'IMPLIED'))),
      ),
    );
  }

  private columnsSection(node: MibNode): HTMLElement | null {
    const entry = node.kind === 'table' ? node.children.find((c) => c.kind === 'entry') : node.kind === 'entry' ? node : null;
    if (!entry || !entry.children.length) return null;
    const rows = entry.children.map((c) =>
      h(
        'tr',
        { class: 'clickable', onClick: () => this.opts.onNavigate(c) },
        h('td', { class: 'num' }, String(c.arc)),
        h('td', null, h('span', { class: 'link' }, displayName(c))),
        h('td', null, h('code', { class: 'muted' }, c.def?.syntax?.base ?? '')),
        h('td', null, h('span', { class: 'muted small' }, c.def?.access ?? '')),
      ),
    );
    const title = node.kind === 'table' ? `Colunas de ${displayName(entry)}` : 'Colunas';
    return section(title, h('table', { class: 'columns-table' }, h('tbody', null, rows)));
  }

  private listSection(title: string, names: string[] | undefined, def?: ObjectDef): HTMLElement | null {
    if (!names?.length || !def) return null;
    return section(
      def.macro === 'TRAP-TYPE' && title === 'OBJECTS' ? 'VARIABLES' : title,
      h('ul', { class: 'link-list' }, names.map((n) => h('li', null, this.symbolLink(n, def)))),
    );
  }

  private complianceSection(def?: ObjectDef): HTMLElement | null {
    if (!def?.compliance?.length) return null;
    return section(
      'MODULE',
      def.compliance.map((cm) =>
        h(
          'div',
          { class: 'compliance' },
          h('div', { class: 'compliance-module' }, cm.module ?? `${def.module} (este módulo)`),
          cm.mandatoryGroups.length > 0 &&
            h('div', null, h('div', { class: 'sub' }, 'MANDATORY-GROUPS'), h('ul', { class: 'link-list' }, cm.mandatoryGroups.map((g) => h('li', null, this.symbolLink(g, def))))),
          cm.groups.length > 0 &&
            h(
              'div',
              null,
              h('div', { class: 'sub' }, 'GROUP'),
              cm.groups.map((g) => h('div', { class: 'refinement' }, this.symbolLink(g.name, def), g.description && h('p', { class: 'prose small' }, reflow(g.description)))),
            ),
          cm.objects.length > 0 &&
            h(
              'div',
              null,
              h('div', { class: 'sub' }, 'OBJECT'),
              cm.objects.map((o) =>
                h(
                  'div',
                  { class: 'refinement' },
                  this.symbolLink(o.name, def),
                  o.syntax && h('div', { class: 'small' }, 'SYNTAX ', h('code', null, o.syntax.raw)),
                  o.writeSyntax && h('div', { class: 'small' }, 'WRITE-SYNTAX ', h('code', null, o.writeSyntax.raw)),
                  o.minAccess && h('div', { class: 'small' }, 'MIN-ACCESS ', h('code', null, o.minAccess)),
                  o.description && h('p', { class: 'prose small' }, reflow(o.description)),
                ),
              ),
            ),
        ),
      ),
    );
  }

  private moduleIdentitySection(def?: ObjectDef): Child {
    if (!def || def.macro !== 'MODULE-IDENTITY') return null;
    return [
      def.lastUpdated && section('LAST-UPDATED', h('p', null, formatSmiDate(def.lastUpdated))),
      this.textSection('ORGANIZATION', def.organization),
      this.textSection('CONTACT-INFO', def.contactInfo),
      def.revisions?.length &&
        section(
          'REVISION',
          h(
            'ul',
            { class: 'revisions' },
            def.revisions.map((r) => h('li', null, h('div', { class: 'rev-date' }, formatSmiDate(r.date)), h('p', { class: 'prose small' }, reflow(r.description)))),
          ),
        ),
    ];
  }

  private textSection(title: string, text?: string): HTMLElement | null {
    return text ? section(title, h('p', { class: 'prose' }, reflow(text))) : null;
  }

  private childrenSection(node: MibNode): HTMLElement | null {
    if (!node.children.length || node.kind === 'table' || node.kind === 'entry') return null;
    const shown = node.children.slice(0, 200);
    return section(
      `Filhos (${node.children.length})`,
      h(
        'ul',
        { class: 'link-list' },
        shown.map((c) =>
          h(
            'li',
            null,
            h('span', { class: `kind-dot kind-${c.kind}` }),
            h('button', { class: 'link', type: 'button', onClick: () => this.opts.onNavigate(c) }, displayName(c)),
            h('span', { class: 'muted small' }, ` (${c.arc})`),
          ),
        ),
        node.children.length > shown.length && h('li', { class: 'muted small' }, `… e mais ${node.children.length - shown.length}`),
      ),
    );
  }

  /** A name from the MIB, clickable when it resolves to a node in the tree. */
  private symbolLink(name: string, from: ObjectDef): HTMLElement {
    const target = this.findNode(name, from.module);
    if (!target) return h('code', { class: 'muted', title: 'Não encontrado nas MIBs carregadas' }, name);
    return h('button', { class: 'link', type: 'button', title: target.oidStr, onClick: () => this.opts.onNavigate(target) }, name);
  }

  private findNode(name: string, module: string): MibNode | undefined {
    const candidates = this.tree.byName.get(name);
    if (!candidates?.length) return undefined;
    const def = this.tree.symbols.lookupObject(name, module);
    return candidates.find((n) => n.def === def || n.aliases.includes(def!)) ?? candidates[0];
  }
}

/**
 * MIB text is hard-wrapped at ~70 columns; re-flow plain paragraphs so they
 * fit the sidebar, but leave lists, tables and indented blocks untouched.
 */
function reflow(text: string): string {
  return text
    .split(/\n[ \t]*\n/)
    .map((para) => {
      const lines = para.split('\n');
      const structured = lines.some((l, i) => (i > 0 && /^\s/.test(l)) || /^\s*([-*•o]|\d+[.)]|[a-z][.)])\s/.test(l) || /\S {3,}\S/.test(l));
      return structured ? para : lines.map((l) => l.trim()).join(' ');
    })
    .join('\n\n');
}

/** Long enumerations are abbreviated: the full list is in the enum table. */
function syntaxText(spec: SyntaxSpec): string {
  if (!spec.enums || spec.enums.length <= 6) return spec.raw;
  const head = spec.enums.slice(0, 3).map((e) => `${e.name}(${e.value})`).join(', ');
  const constraint = spec.raw.slice(spec.raw.lastIndexOf('}') + 1).trim();
  return `${spec.base} { ${head}, … +${spec.enums.length - 3} }${constraint ? ' ' + constraint : ''}`;
}

/** Lets a dotted OID wrap only after its dots (never inside `mib-2`). */
function breakAtDots(oid: string): Child[] {
  return oid.split('.').map((part, i, all) => [h('span', { class: 'nowrap' }, i < all.length - 1 ? part + '.' : part), i < all.length - 1 && h('wbr')]);
}

function section(title: string, ...content: Child[]): HTMLElement {
  return h('section', { class: 'detail-section' }, h('h3', null, title), content);
}

function copyButton(text: string, label: string): HTMLButtonElement {
  const btn = h('button', { class: 'icon-btn copy-btn', type: 'button', title: label, 'aria-label': label }, icon('copy', 14));
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      fallbackCopy(text);
    }
    btn.replaceChildren(icon('check', 14));
    btn.classList.add('done');
    setTimeout(() => {
      btn.replaceChildren(icon('copy', 14));
      btn.classList.remove('done');
    }, 1200);
  });
  return btn;
}

function fallbackCopy(text: string): void {
  const ta = h('textarea', { style: 'position:fixed;opacity:0' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

/** `YYYYMMDDHHMMZ` (or SMIv1 `YYMMDDHHMMZ`) → `YYYY-MM-DD HH:MM UTC`. */
function formatSmiDate(s: string): string {
  const m = s.match(/^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})Z$/i);
  if (!m) return s;
  const year = m[1].length === 2 ? `19${m[1]}` : m[1];
  return `${year}-${m[2]}-${m[3]} ${m[4]}:${m[5]} UTC`;
}
