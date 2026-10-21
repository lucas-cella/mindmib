import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';

import type { MibNode, MibTree } from './mib';
import { Store } from './state/store';
import { h, icon, iconButton } from './ui/dom';
import { KIND_LABEL, LEGEND_KINDS } from './ui/kinds';
import { Loader } from './ui/loader';
import { Mindmap } from './ui/mindmap';
import { Search } from './ui/search';
import { Sidebar } from './ui/sidebar';

const WIDE = window.matchMedia('(min-width: 760px)');

async function main(): Promise<void> {
  const store = new Store();
  const app = document.getElementById('app')!;

  const toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
  const toast = (msg: string, kind: 'info' | 'warn' = 'info') => {
    const el = h('div', { class: `toast ${kind}` }, kind === 'warn' && icon('alert', 14), h('span', null, msg));
    toasts.append(el);
    setTimeout(() => el.classList.add('leaving'), kind === 'warn' ? 7000 : 4000);
    setTimeout(() => el.remove(), kind === 'warn' ? 7400 : 4400);
  };

  const searchSlot = h('div', { class: 'search-slot' });
  const canvas = h('div', { class: 'canvas' });
  const sidebarEl = h('aside', { class: 'sidebar', 'aria-label': 'Detalhes do objeto' });
  const hint = h('div', { class: 'hint' }, 'Arraste arquivos .mib para a janela ou use “Carregar MIB”.');

  const sidebar = new Sidebar(sidebarEl, {
    onNavigate: (node) => reveal(node),
    onClose: () => {
      sidebar.close();
      mindmap.select(null);
      syncSidebar();
    },
  });

  const mindmap = new Mindmap(canvas, {
    onSelect: (node) => {
      sidebar.show(node);
      syncSidebar();
      mindmap.ensureVisible(node, false);
    },
    insetLeft: () => (sidebar.isOpen && WIDE.matches ? sidebarEl.offsetWidth : 0),
  });

  const search = new Search(searchSlot, (node) => reveal(node));
  const loader = new Loader(store, toast, (modules) => mindmap.showNodes(topNodesOf(store.tree, new Set(modules))));

  function reveal(node: MibNode): void {
    sidebar.show(node);
    syncSidebar();
    mindmap.reveal(node);
  }

  function syncSidebar(): void {
    document.body.classList.toggle('sidebar-open', sidebar.isOpen);
  }

  function setTree(tree: MibTree): void {
    mindmap.setTree(tree);
    sidebar.setTree(tree);
    search.setTree(tree);
    loader.setTree(tree);
    hint.hidden = store.files.length > 0;
    syncSidebar();
  }

  const controls = h(
    'div',
    { class: 'controls' },
    iconButton('plus', 'Aproximar', () => mindmap.zoomBy(1.25)),
    iconButton('minus', 'Afastar', () => mindmap.zoomBy(0.8)),
    h('span', { class: 'controls-sep' }),
    iconButton('target', 'Centralizar', () => mindmap.recenter()),
    iconButton('collapse', 'Recolher tudo', () => mindmap.collapseAll()),
  );

  const legend = h(
    'div',
    { class: 'legend' },
    LEGEND_KINDS.map((k) => h('span', { class: 'legend-item' }, h('span', { class: `kind-dot kind-${k}` }), KIND_LABEL[k])),
  );

  app.append(
    h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }), h('span', { class: 'brand-name' }, 'MindMIB')),
      searchSlot,
      h('div', { class: 'actions' }, loader.openButton, loader.modulesButton),
    ),
    h('main', { class: 'stage' }, canvas, sidebarEl, legend, controls, hint),
    toasts,
  );

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.isOpen && !(e.target instanceof HTMLInputElement)) {
      sidebar.close();
      mindmap.select(null);
      syncSidebar();
    }
  });

  // Labels are measured on a canvas, so the font must be ready first.
  try {
    await Promise.all([document.fonts.load('500 13px Inter'), document.fonts.load('400 12px Inter')]);
  } catch {
    /* fall back to whatever font is available */
  }

  store.onChange(setTree);
  setTree(store.tree);
  if (store.persistError) toast(store.persistError, 'warn');

  // MIBs remembered from a previous session start out revealed, too.
  const remembered = store.files.flatMap((f) => store.modulesOf(f.name));
  if (remembered.length) mindmap.showNodes(topNodesOf(store.tree, new Set(remembered)));
}

/**
 * The highest nodes defined by the given modules: their MODULE-IDENTITY or
 * vendor root, plus any branch they attach to existing parts of the tree.
 */
function topNodesOf(tree: MibTree, modules: Set<string>): MibNode[] {
  const own = (n: MibNode) => (n.def && modules.has(n.def.module)) || n.aliases.some((a) => modules.has(a.module));
  const tops: MibNode[] = [];
  for (const node of tree.byOid.values()) {
    if (!own(node)) continue;
    let nested = false;
    for (let p = node.parent; p && !nested; p = p.parent) nested = own(p);
    if (!nested) tops.push(node);
  }
  return tops.sort((a, b) => a.oidStr.localeCompare(b.oidStr, undefined, { numeric: true })).slice(0, 20);
}

void main();
