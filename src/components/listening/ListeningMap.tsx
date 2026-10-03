import type { MapDiagram } from "@/lib/listening/map-diagram";
export function ListeningMap({diagram}: {diagram: MapDiagram}) {
  return <svg viewBox={diagram.viewBox.join(" ")} role="img" aria-label={diagram.label} className="h-auto w-full bg-white text-black" data-listening-map>
    {diagram.shapes.map(({tag: Tag, text, ...attributes}, index) => <Tag key={index} {...attributes}>{Tag === "text" ? text : undefined}</Tag>)}
  </svg>;
}
