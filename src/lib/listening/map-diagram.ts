import { z } from "zod";
const number = z.number().finite().min(-10000).max(10000);
const color = z.string().regex(/^(none|#[0-9a-f]{3,8})$/i);
export const mapDiagramSchema = z.object({
  viewBox: z.tuple([number, number, number.positive(), number.positive()]),
  label: z.string().min(1).max(200),
  shapes: z.array(z.object({
    tag: z.enum(["rect", "path", "text", "line", "circle"]),
    x: number.optional(), y: number.optional(), width: number.nonnegative().optional(), height: number.nonnegative().optional(),
    rx: number.nonnegative().optional(), cx: number.optional(), cy: number.optional(), r: number.nonnegative().optional(),
    x1: number.optional(), x2: number.optional(), y1: number.optional(), y2: number.optional(),
    d: z.string().max(12000).regex(/^[MmLlHhVvCcSsQqTtAaZz0-9.,+\-\sEe]*$/).optional(),
    fill: color.optional(), stroke: color.optional(), strokeWidth: number.nonnegative().max(30).optional(),
    strokeDasharray: z.string().regex(/^[0-9. ,]*$/).max(100).optional(),
    textAnchor: z.enum(["start", "middle", "end"]).optional(), fontSize: number.positive().max(100).optional(),
    text: z.string().max(300).optional(),
  })).min(1).max(500),
});
export type MapDiagram = z.infer<typeof mapDiagramSchema>;
/** Coordinates and literal text only; never serialize arbitrary SVG or execute source HTML. */
export function extractMapDiagram(svg: Element): MapDiagram {
  const shapes = [...svg.querySelectorAll("rect,path,text,line,circle")].map(node => {
    const shape: Record<string, unknown> = {tag: node.localName};
    for (const name of ["x","y","width","height","rx","cx","cy","r","x1","x2","y1","y2"]) {
      if (node.hasAttribute(name)) shape[name] = Number(node.getAttribute(name));
    }
    for (const [attribute, key] of [["d","d"],["fill","fill"],["stroke","stroke"],["stroke-width","strokeWidth"],["stroke-dasharray","strokeDasharray"],["text-anchor","textAnchor"],["font-size","fontSize"]]) {
      if (node.hasAttribute(attribute!)) shape[key!] = ["strokeWidth","fontSize"].includes(key!) ? Number(node.getAttribute(attribute!)) : node.getAttribute(attribute!);
    }
    if (node.localName === "text") shape.text = node.textContent ?? "";
    return shape;
  });
  return mapDiagramSchema.parse({viewBox: (svg.getAttribute("viewBox") ?? "").trim().split(/\s+/).map(Number), label: svg.getAttribute("aria-label") ?? "Source map", shapes});
}
