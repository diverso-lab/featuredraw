# FeatureDraw

Web app para dibujar **Feature Models** con drag & drop y exportar/importar **UVL** (Universal Variability Language).

## Stack
- Next.js 15 (App Router) + React 19 + TypeScript
- React Flow (`@xyflow/react`) para el editor visual
- Zustand para el estado
- Tailwind CSS
- Docker + docker-compose (hot reload)

## Cómo arrancar

```bash
docker compose up --build
```

Abre http://localhost:3000

## Features del MVP
- Editor visual con grid, snap, zoom, pan, minimap
- Nodos de feature con tipo (Boolean/Integer/Float/String), atributos, cardinalidad
- Edges con marker **mandatory** (●) / **optional** (○) estilo FODA
- Grupos **or** / **alternative (XOR)** / **cardinality [n..m]** con arco entre hermanos
- Cross-tree constraints
- Export **SVG / PNG / JPG / PDF** con fondo transparente opcional y leyenda opcional
- Export/Import **UVL** (ejemplo eShop del paper de UVL cargado por defecto)

## Estructura
- `src/app/` — Next.js App Router
- `src/components/` — `Canvas`, `Sidebar`, `FeatureNode`, `FeatureEdge`, `GroupArcs`
- `src/lib/store.ts` — Zustand store
- `src/lib/uvl.ts` — exporter a UVL
- `src/lib/uvlParser.ts` — importer desde UVL
- `src/lib/exporter.ts` — SVG/PNG/JPG/PDF
