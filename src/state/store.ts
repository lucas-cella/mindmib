// Application state: the user's MIB files (persisted) and the merged tree.

import { loadMibs, type MibTree, type SourceFile } from '../mib';
import { BUILTIN_FILES } from '../mib/builtin';

const STORAGE_KEY = 'mindmib.files.v1';

type Listener = (tree: MibTree) => void;

export class Store {
  /** User files, in load order. Built-ins are always loaded before them. */
  files: SourceFile[] = [];
  tree: MibTree;
  /** Set when the last save to localStorage failed (e.g. quota exceeded). */
  persistError: string | null = null;
  private listeners: Listener[] = [];

  constructor() {
    this.files = readStorage();
    this.tree = this.build();
  }

  onChange(fn: Listener): void {
    this.listeners.push(fn);
  }

  /** Adds files, replacing any previously loaded file with the same name. */
  addFiles(files: SourceFile[]): void {
    const names = new Set(files.map((f) => f.name));
    this.files = [...this.files.filter((f) => !names.has(f.name)), ...files];
    this.commit();
  }

  removeFile(name: string): void {
    this.files = this.files.filter((f) => f.name !== name);
    this.commit();
  }

  clear(): void {
    this.files = [];
    this.commit();
  }

  /** Modules defined by a given user file. */
  modulesOf(fileName: string): string[] {
    return [...this.tree.modules.values()].filter((m) => m.file === fileName).map((m) => m.name);
  }

  private commit(): void {
    this.persistError = writeStorage(this.files);
    this.tree = this.build();
    for (const fn of this.listeners) fn(this.tree);
  }

  private build(): MibTree {
    return loadMibs([...BUILTIN_FILES, ...this.files]);
  }
}

function readStorage(): SourceFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data.filter((f) => typeof f?.name === 'string' && typeof f?.text === 'string') : [];
  } catch {
    return [];
  }
}

function writeStorage(files: SourceFile[]): string | null {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files.map(({ name, text }) => ({ name, text }))));
    return null;
  } catch (e) {
    return e instanceof DOMException && e.name === 'QuotaExceededError'
      ? 'As MIBs carregadas excedem o espaço do navegador; elas não serão lembradas na próxima sessão.'
      : 'Não foi possível salvar as MIBs no navegador.';
  }
}
