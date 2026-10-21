// Horizontal, collapsible OID mindmap rendered as SVG.
//
// Only expanded branches are laid out and rendered, so the cost depends on
// what is visible, not on the size of the loaded MIBs.

import { hierarchy, tree as d3tree, type HierarchyPointNode } from 'd3-hierarchy';
import { select, type Selection } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { pathTo, type MibNode, type MibTree } from '../mib';

const ROW = 30; // vertical distance between sibling rows
const GAP = 52; // horizontal gap between columns
const LABEL_X = 14; // label offset after the kind dot
const TOGGLE_R = 7;
const TOGGLE_GAP = 8;
const NAME_FONT = '500 13px Inter, system-ui, sans-serif';
const ARC_FONT = '400 12px Inter, system-ui, sans-serif';
const DURATION = 300;
/** Above this many visible nodes, skip enter/exit animations. */
const ANIMATE_LIMIT = 1500;
const MARGIN = 24;

type PNode = HierarchyPointNode<MibNode>;
interface Pos {
  x: number;
  y: number;
  w: number;
}

export interface MindmapOptions {
  onSelect(node: MibNode): void;
  /** Width covered by an overlay on the left (the open sidebar), in px. */
  insetLeft(): number;
}

export class Mindmap {
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly viewport: Selection<SVGGElement, unknown, null, undefined>;
  private readonly linkLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly nodeLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>;
  private readonly measure = document.createElement('canvas').getContext('2d')!;
  private readonly widths = new WeakMap<MibNode, { name: number; arc: number }>();

  private tree!: MibTree;
  private expanded = new Set<string>();
  private selected: MibNode | null = null;
  private pos = new Map<string, Pos>();

  constructor(
    private readonly el: HTMLElement,
    private readonly opts: MindmapOptions,
  ) {
    this.svg = select(el).append('svg').attr('class', 'mindmap');
    this.viewport = this.svg.append('g');
    this.linkLayer = this.viewport.append('g').attr('class', 'links');
    this.nodeLayer = this.viewport.append('g').attr('class', 'nodes');

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 2.5])
      .on('zoom', (e) => this.viewport.attr('transform', e.transform.toString()));
    this.svg.call(this.zoomBehavior).on('dblclick.zoom', null);
  }

  // ---- public API ----------------------------------------------------------

  setTree(tree: MibTree): void {
    const first = !this.tree;
    const selectedOid = this.selected?.oidStr;
    this.tree = tree;
    this.expanded = first ? this.initialExpansion() : new Set([...this.expanded].filter((oid) => tree.byOid.has(oid)));
    this.selected = selectedOid ? (tree.byOid.get(selectedOid) ?? null) : null;
    // Nodes are new objects: drop the old DOM instead of morphing it.
    this.nodeLayer.selectAll('*').remove();
    this.linkLayer.selectAll('*').remove();
    this.pos.clear();
    this.render(null, false);
    if (first) this.fit(false);
  }

  toggle(node: MibNode): void {
    if (!node.children.length) return;
    const opening = !this.expanded.has(node.oidStr);
    if (opening) this.expanded.add(node.oidStr);
    else this.collapse(node);
    this.render(node, true);
    if (opening) this.ensureVisible(node);
  }

  /** Expands every ancestor of `node`, selects it and centres the view on it. */
  reveal(node: MibNode): void {
    for (const n of pathTo(node).slice(0, -1)) this.expanded.add(n.oidStr);
    if (this.isVirtualRootShown()) this.expanded.add('');
    this.selected = node;
    this.render(node.parent, true);
    this.centerOn(node);
  }

  select(node: MibNode | null): void {
    this.selected = node;
    this.nodeLayer.selectAll<SVGGElement, PNode>('g.node').classed('selected', (d) => d.data === node);
  }

  collapseAll(): void {
    this.expanded = this.initialExpansion();
    this.render(this.displayRoot(), true);
    this.fit(true);
  }

  zoomBy(factor: number): void {
    this.svg.transition().duration(200).call(this.zoomBehavior.scaleBy, factor);
  }

  /** Centres on the selection if there is one, otherwise fits the visible tree. */
  recenter(): void {
    if (this.selected && this.pos.has(this.selected.oidStr)) this.centerOn(this.selected);
    else this.fit(true);
  }

  centerOn(node: MibNode, animate = true): void {
    const p = this.pos.get(node.oidStr);
    if (!p) return;
    const { width, height } = this.size();
    const inset = this.opts.insetLeft();
    const k = Math.max(this.currentScale(), 0.6);
    const tx = inset + (width - inset) * 0.3 - p.x * k;
    const ty = height / 2 - p.y * k;
    this.applyTransform(zoomIdentity.translate(tx, ty).scale(k), animate);
  }

  /**
   * Opens the branches leading to `nodes` (and the nodes themselves), frames
   * them and briefly highlights them. Used after loading new MIBs, whose
   * objects usually live under collapsed branches such as `enterprises`.
   */
  showNodes(nodes: MibNode[]): void {
    if (!nodes.length) return;
    // With many new roots, opening all of them would only produce noise.
    const openRoots = nodes.length <= 3;
    for (const node of nodes) {
      for (const n of pathTo(node).slice(0, -1)) this.expanded.add(n.oidStr);
      if (openRoots && node.children.length) this.expanded.add(node.oidStr);
    }
    if (this.isVirtualRootShown()) this.expanded.add('');
    this.render(null, true);

    const focus = new Set<string>();
    for (const node of nodes) {
      focus.add(node.oidStr);
      if (this.expanded.has(node.oidStr)) for (const c of node.children) focus.add(c.oidStr);
    }
    // Frame everything when it stays legible, otherwise start at the first one.
    const framed = this.fitTransform(focus);
    if (framed && framed.k >= 0.55) this.applyTransform(framed, true);
    else this.centerOn(nodes[0]);

    const fresh = new Set(nodes);
    const sel = this.nodeLayer.selectAll<SVGGElement, PNode>('g.node').filter((d) => fresh.has(d.data));
    sel.classed('fresh', true);
    setTimeout(() => sel.classed('fresh', false), 2600);
  }

  fit(animate: boolean): void {
    const t = this.fitTransform();
    if (t) this.applyTransform(t, animate);
  }

  /** Transform that frames the visible tree, or only the nodes whose OIDs are in `only`. */
  private fitTransform(only?: Set<string>): ZoomTransform | null {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [oid, p] of this.pos) {
      if (only && !only.has(oid)) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + p.w);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    if (minX === Infinity) return null;
    const { width, height } = this.size();
    const inset = this.opts.insetLeft();
    const availW = width - inset - 2 * MARGIN;
    const availH = height - 2 * MARGIN;
    const k = Math.min(1, availW / Math.max(1, maxX - minX), availH / Math.max(1, maxY - minY + ROW));
    const scale = Math.max(0.2, k);
    const tx = inset + MARGIN + (availW - (maxX - minX) * scale) / 2 - minX * scale;
    const ty = height / 2 - ((minY + maxY) / 2) * scale;
    return zoomIdentity.translate(tx, ty).scale(scale);
  }

  // ---- layout & rendering --------------------------------------------------

  private initialExpansion(): Set<string> {
    // Start collapsed, but with the path to `internet` open: everything
    // interesting lives below it.
    return new Set(['', '1', '1.3', '1.3.6', '1.3.6.1']);
  }

  /** The virtual root is shown only when there is something besides iso(1). */
  private isVirtualRootShown(): boolean {
    return this.tree.root.children.length > 1;
  }

  private displayRoot(): MibNode {
    return this.isVirtualRootShown() ? this.tree.root : this.tree.byOid.get('1')!;
  }

  private collapse(node: MibNode): void {
    // Collapsing forgets the expansion state of the whole subtree.
    const prefix = node.oidStr + '.';
    for (const oid of [...this.expanded]) if (oid === node.oidStr || oid.startsWith(prefix)) this.expanded.delete(oid);
  }

  private labelWidths(node: MibNode): { name: number; arc: number } {
    let w = this.widths.get(node);
    if (!w) {
      const { name, arc } = labelParts(node);
      this.measure.font = NAME_FONT;
      const nameW = this.measure.measureText(name).width;
      this.measure.font = ARC_FONT;
      w = { name: nameW, arc: this.measure.measureText(arc).width };
      this.widths.set(node, w);
    }
    return w;
  }

  private textWidth(node: MibNode): number {
    const w = this.labelWidths(node);
    return w.name + w.arc;
  }

  private nodeWidth(node: MibNode): number {
    const base = LABEL_X + this.textWidth(node);
    return node.children.length ? base + TOGGLE_GAP + 2 * TOGGLE_R : base;
  }

  private layout(): { nodes: PNode[]; next: Map<string, Pos> } {
    const root = hierarchy(this.displayRoot(), (n) => (this.expanded.has(n.oidStr) ? n.children : null));
    const laid = d3tree<MibNode>()
      .nodeSize([ROW, 1])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.4))(root);
    const nodes = laid.descendants();

    // Columns are as wide as their widest visible label.
    const colW: number[] = [];
    for (const n of nodes) colW[n.depth] = Math.max(colW[n.depth] ?? 0, this.nodeWidth(n.data));
    const colX = [0];
    for (let d = 1; d < colW.length; d++) colX[d] = colX[d - 1] + colW[d - 1] + GAP;

    const next = new Map<string, Pos>();
    for (const n of nodes) next.set(n.data.oidStr, { x: colX[n.depth], y: n.x, w: this.nodeWidth(n.data) });
    return { nodes, next };
  }

  /**
   * Re-renders the visible tree. `source` is the node whose expansion changed:
   * entering nodes grow out of it and exiting nodes shrink back into it.
   */
  private render(source: MibNode | null, animate: boolean): void {
    const { nodes, next } = this.layout();
    const prev = this.pos;
    this.pos = next;
    const duration = animate && nodes.length < ANIMATE_LIMIT ? DURATION : 0;

    // Anchor points: the toggle of `source` before and after the change.
    const anchor = (m: Map<string, Pos>, fallback: Pos): [number, number] => {
      const p = (source && (m.get(source.oidStr) ?? next.get(source.oidStr))) || fallback;
      return [p.x + p.w, p.y];
    };
    const posOf = (d: PNode) => next.get(d.data.oidStr)!;

    // ---- links ----
    const links = nodes.filter((n) => n.parent);
    const linkSel = this.linkLayer.selectAll<SVGPathElement, PNode>('path.link').data(links, (d) => d.data.oidStr);

    linkSel
      .enter()
      .append('path')
      .attr('class', 'link')
      .attr('d', (d) => {
        const [x, y] = anchor(prev, posOf(d.parent!));
        return curve(x, y, x, y);
      })
      .merge(linkSel)
      .transition()
      .duration(duration)
      .attr('d', (d) => {
        const s = posOf(d.parent!);
        const t = posOf(d);
        return curve(s.x + s.w, s.y, t.x, t.y);
      });

    linkSel
      .exit<PNode>()
      .transition()
      .duration(duration)
      .attr('d', (d) => {
        const [x, y] = anchor(next, prev.get(d.parent!.data.oidStr) ?? { x: 0, y: 0, w: 0 });
        return curve(x, y, x, y);
      })
      .remove();

    // ---- nodes ----
    const nodeSel = this.nodeLayer.selectAll<SVGGElement, PNode>('g.node').data(nodes, (d) => d.data.oidStr);

    const entered = nodeSel
      .enter()
      .append('g')
      .attr('class', (d) => `node kind-${d.data.kind}`)
      .attr('opacity', 0)
      .attr('transform', (d) => {
        const [x, y] = anchor(prev, posOf(d));
        return `translate(${x},${y})`;
      });
    entered.each((d, i, groups) => this.buildNode(select(groups[i]), d.data));

    const merged = entered.merge(nodeSel);
    merged
      .classed('selected', (d) => d.data === this.selected)
      .classed('expanded', (d) => this.expanded.has(d.data.oidStr));
    merged.select('.toggle-v').attr('opacity', (d) => (this.expanded.has(d.data.oidStr) ? 0 : 1));
    merged
      .transition()
      .duration(duration)
      .attr('opacity', 1)
      .attr('transform', (d) => `translate(${posOf(d).x},${posOf(d).y})`);

    nodeSel
      .exit<PNode>()
      .transition()
      .duration(duration)
      .attr('opacity', 0)
      .attr('transform', (d) => {
        const [x, y] = anchor(next, prev.get(d.data.oidStr) ?? { x: 0, y: 0, w: 0 });
        return `translate(${x},${y})`;
      })
      .remove();
  }

  private buildNode(g: Selection<SVGGElement, PNode, null, undefined>, node: MibNode): void {
    const { name, arc } = labelParts(node);
    const textW = this.textWidth(node);

    g.append('rect')
      .attr('class', 'hit')
      .attr('x', LABEL_X - 6)
      .attr('y', -11)
      .attr('width', textW + 12)
      .attr('height', 22)
      .attr('rx', 6)
      .on('click', (e: MouseEvent) => {
        e.stopPropagation();
        this.select(node);
        this.opts.onSelect(node);
      });

    g.append('circle').attr('class', 'dot').attr('cx', 4).attr('r', 3.5);

    const text = g.append('text').attr('class', 'label').attr('x', LABEL_X).attr('dy', '0.35em');
    text.append('tspan').attr('class', 'name').text(name);
    text.append('tspan').attr('class', 'arc').text(arc);
    text.append('title').text(node.oidStr);

    if (node.children.length) {
      const cx = LABEL_X + textW + TOGGLE_GAP + TOGGLE_R;
      const t = g
        .append('g')
        .attr('class', 'toggle')
        .attr('transform', `translate(${cx},0)`)
        .on('click', (e: MouseEvent) => {
          e.stopPropagation();
          this.toggle(node);
        });
      t.append('title').text(`${node.children.length} ${node.children.length === 1 ? 'filho' : 'filhos'}`);
      t.append('circle').attr('r', TOGGLE_R);
      t.append('path').attr('d', 'M-3.5,0H3.5');
      t.append('path').attr('class', 'toggle-v').attr('d', 'M0,-3.5V3.5');
    }
  }

  // ---- viewport helpers ----------------------------------------------------

  private size(): { width: number; height: number } {
    return { width: this.el.clientWidth, height: this.el.clientHeight };
  }

  private currentScale(): number {
    return zoomTransform(this.svg.node()!).k;
  }

  private applyTransform(t: ZoomTransform, animate: boolean): void {
    if (animate) this.svg.transition().duration(450).call(this.zoomBehavior.transform, t);
    else this.svg.call(this.zoomBehavior.transform, t);
  }

  /** Centres on `node` if it (or, optionally, its visible children) is off screen. */
  ensureVisible(node: MibNode, withChildren = true): void {
    const p = this.pos.get(node.oidStr);
    if (!p) return;
    let minY = p.y, maxY = p.y, maxX = p.x + p.w;
    for (const c of withChildren ? node.children : []) {
      const cp = this.pos.get(c.oidStr);
      if (!cp) continue;
      minY = Math.min(minY, cp.y);
      maxY = Math.max(maxY, cp.y);
      maxX = Math.max(maxX, cp.x + cp.w);
    }
    const t = zoomTransform(this.svg.node()!);
    const { width, height } = this.size();
    const left = this.opts.insetLeft() + MARGIN;
    const sx0 = p.x * t.k + t.x;
    const sx1 = maxX * t.k + t.x;
    const sy0 = minY * t.k + t.y - ROW / 2;
    const sy1 = maxY * t.k + t.y + ROW / 2;
    if (sx0 < left || sx1 > width - MARGIN || sy0 < MARGIN || sy1 > height - MARGIN) this.centerOn(node);
  }
}

function labelParts(node: MibNode): { name: string; arc: string } {
  if (node.kind === 'root') return { name: 'root', arc: '' };
  return node.name ? { name: node.name, arc: ` (${node.arc})` } : { name: '', arc: `(${node.arc})` };
}

function curve(x0: number, y0: number, x1: number, y1: number): string {
  const mx = (x0 + x1) / 2;
  return `M${x0},${y0}C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
}
