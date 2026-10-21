// Loading MIB files (button + drag-and-drop) and the "Módulos" panel with
// loaded files, built-ins and warnings.

import type { MibTree, SourceFile } from '../mib';
import type { Store } from '../state/store';
import { append, h, icon, iconButton } from './dom';

const ACCEPT = ['.mib', '.txt', '.my', '.smi'];
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export class Loader {
  private readonly fileInput: HTMLInputElement;
  private readonly panel: HTMLElement;
  private readonly badge: HTMLElement;
  readonly openButton: HTMLButtonElement;
  readonly modulesButton: HTMLButtonElement;

  constructor(
    private readonly store: Store,
    private readonly toast: (msg: string, kind?: 'info' | 'warn') => void,
    private readonly onLoaded: (modules: string[]) => void,
  ) {
    this.fileInput = h('input', { type: 'file', multiple: true, accept: ACCEPT.join(','), hidden: true });
    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files) void this.load([...this.fileInput.files]);
      this.fileInput.value = '';
    });

    this.openButton = h(
      'button',
      { class: 'btn', type: 'button', title: 'Carregar arquivos MIB', onClick: () => this.fileInput.click() },
      icon('upload'),
      h('span', { class: 'btn-label' }, 'Carregar MIB'),
    );
    this.badge = h('span', { class: 'badge', hidden: true });
    this.modulesButton = h(
      'button',
      { class: 'btn ghost', type: 'button', title: 'Módulos carregados e avisos', onClick: () => this.togglePanel() },
      icon('layers'),
      h('span', { class: 'btn-label' }, 'Módulos'),
      this.badge,
    );
    this.panel = h('aside', { class: 'modules-panel', 'aria-label': 'Módulos' });
    document.body.append(this.fileInput, this.panel, this.dropOverlay());

    document.addEventListener('mousedown', (e) => {
      const t = e.target as Node;
      if (this.panel.classList.contains('open') && !this.panel.contains(t) && !this.modulesButton.contains(t)) this.closePanel();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closePanel();
    });
  }

  setTree(tree: MibTree): void {
    const warnings = tree.missingImports.length + (tree.unresolved.length ? 1 : 0) + tree.diagnostics.filter((d) => d.severity === 'error').length;
    this.badge.hidden = warnings === 0;
    this.badge.textContent = String(warnings);
    this.renderPanel(tree);
  }

  async load(files: File[]): Promise<void> {
    const accepted: SourceFile[] = [];
    const skipped: string[] = [];
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        skipped.push(f.name);
        continue;
      }
      accepted.push({ name: f.name, text: await f.text() });
    }
    if (!accepted.length) {
      if (skipped.length) this.toast(`Arquivos grandes demais ignorados: ${skipped.join(', ')}`, 'warn');
      return;
    }

    const before = new Set(this.store.tree.modules.keys());
    this.store.addFiles(accepted);
    const tree = this.store.tree;
    const added = accepted.flatMap((f) => this.store.modulesOf(f.name));
    const newModules = added.filter((m) => !before.has(m)).length;

    const parts = [`${added.length} ${added.length === 1 ? 'módulo carregado' : 'módulos carregados'}`];
    if (newModules < added.length) parts.push(`${added.length - newModules} substituído(s)`);
    const outside = tree.unresolved.filter((u) => added.includes(u.module)).length;
    if (outside) parts.push(`${outside} objeto(s) fora do mapa`);
    if (tree.missingImports.length) parts.push(`faltando: ${tree.missingImports.map((m) => m.module).join(', ')}`);
    const noModules = accepted.filter((f) => !this.store.modulesOf(f.name).length).map((f) => f.name);
    if (noModules.length) parts.push(`sem módulo válido: ${noModules.join(', ')}`);
    if (skipped.length) parts.push(`ignorados: ${skipped.join(', ')}`);
    this.toast(parts.join(' · '), tree.missingImports.length || noModules.length || outside ? 'warn' : 'info');
    if (this.store.persistError) this.toast(this.store.persistError, 'warn');
    this.onLoaded(added);
  }

  togglePanel(): void {
    if (this.panel.classList.contains('open')) this.closePanel();
    else this.panel.classList.add('open');
  }

  private closePanel(): void {
    this.panel.classList.remove('open');
  }

  private renderPanel(tree: MibTree): void {
    const userFiles = this.store.files;
    const builtinModules = [...tree.modules.values()].filter((m) => !userFiles.some((f) => f.name === m.file));
    const errors = tree.diagnostics.filter((d) => d.severity === 'error');

    const warnings: HTMLElement[] = [];
    if (tree.missingImports.length) {
      warnings.push(
        h(
          'div',
          { class: 'warn-block' },
          h('div', { class: 'warn-title' }, icon('alert', 14), 'Módulos importados que não foram carregados'),
          h(
            'ul',
            null,
            tree.missingImports.map((m) => h('li', null, h('code', null, m.module), h('span', { class: 'muted small' }, ` ← ${m.requiredBy.join(', ')}`))),
          ),
        ),
      );
    }
    if (tree.unresolved.length) {
      warnings.push(
        h(
          'details',
          { class: 'warn-block' },
          h('summary', { class: 'warn-title' }, icon('alert', 14), `${tree.unresolved.length} objeto(s) sem OID resolvido (fora do mapa)`),
          h('ul', null, tree.unresolved.slice(0, 300).map((u) => h('li', null, h('code', null, u.name), h('span', { class: 'muted small' }, ` ${u.module}: ${u.reason}`)))),
        ),
      );
    }
    if (errors.length) {
      warnings.push(
        h(
          'details',
          { class: 'warn-block' },
          h('summary', { class: 'warn-title' }, icon('alert', 14), `${errors.length} erro(s) de parsing (definições ignoradas)`),
          h('ul', null, errors.slice(0, 300).map((d) => h('li', { class: 'small' }, h('code', null, `${d.file ?? d.module ?? ''}${d.line ? ':' + d.line : ''}`), ` ${d.message}`))),
        ),
      );
    }

    this.panel.replaceChildren();
    append(this.panel, [
      h('div', { class: 'panel-head' }, h('h3', null, 'Módulos'), iconButton('close', 'Fechar', () => this.closePanel())),
      warnings.length > 0 && h('div', { class: 'panel-section' }, warnings),
      h(
        'div',
        { class: 'panel-section' },
        h('h4', null, 'Seus arquivos'),
        userFiles.length
          ? h(
              'ul',
              { class: 'file-list' },
              userFiles.map((f) =>
                h(
                  'li',
                  null,
                  icon('file', 14),
                  h('div', { class: 'file-info' }, h('div', { class: 'file-name' }, f.name), h('div', { class: 'muted small' }, this.store.modulesOf(f.name).join(', ') || 'nenhum módulo')),
                  iconButton('trash', `Remover ${f.name}`, () => this.store.removeFile(f.name)),
                ),
              ),
            )
          : h('p', { class: 'muted small' }, 'Nenhum arquivo carregado. Use “Carregar MIB” ou arraste arquivos para a janela.'),
        userFiles.length > 1 && h('button', { class: 'btn ghost small', type: 'button', onClick: () => this.store.clear() }, 'Remover todos'),
      ),
      h(
        'div',
        { class: 'panel-section' },
        h('h4', null, 'Embutidas'),
        h('p', { class: 'muted small' }, builtinModules.map((m) => m.name).join(', ')),
      ),
      h('div', { class: 'panel-foot muted small' }, `${tree.size.toLocaleString('pt-BR')} nós · ${tree.modules.size} módulos`),
    ]);
  }

  private dropOverlay(): HTMLElement {
    const overlay = h('div', { class: 'drop-overlay' }, h('div', { class: 'drop-box' }, icon('upload', 28), h('p', null, 'Solte os arquivos MIB para carregar')));
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth++;
      overlay.classList.add('visible');
    });
    window.addEventListener('dragleave', () => {
      if (--depth <= 0) {
        depth = 0;
        overlay.classList.remove('visible');
      }
    });
    window.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      overlay.classList.remove('visible');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void this.load(files);
    });
    return overlay;
  }
}
