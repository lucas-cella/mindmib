import type { NodeKind } from '../mib';

export const KIND_LABEL: Record<NodeKind, string> = {
  root: 'Raiz',
  branch: 'Ramo',
  module: 'Módulo',
  scalar: 'Escalar',
  table: 'Tabela',
  entry: 'Linha (entry)',
  column: 'Coluna',
  notification: 'Notificação',
  group: 'Grupo',
  compliance: 'Conformidade',
};

/** Kinds shown in the legend, in display order. */
export const LEGEND_KINDS: NodeKind[] = ['branch', 'scalar', 'table', 'entry', 'column', 'notification', 'group'];
