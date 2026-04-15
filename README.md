# FeatureDraw

Web app for drawing **Feature Models** with drag & drop and importing / exporting **UVL** (Universal Variability Language).

## Stack
- Next.js 15 (App Router) + React 19 + TypeScript
- React Flow (`@xyflow/react`) for the visual editor
- Zustand for state management
- Tailwind CSS
- Docker + docker-compose (hot reload)

## Getting started

```bash
docker compose up --build
```

Open http://localhost:3000

## Features
- Visual editor with grid, snap, zoom, pan, minimap
- Feature nodes with type (Boolean / Integer / Float / String), attributes and cardinality
- Edges with FODA-style **mandatory** (●) / **optional** (○) markers
- Groups: **or**, **alternative (XOR)** and **cardinality [n..m]** rendered with a sibling arc
- Cross-tree constraints — visual editor for `requires` / `excludes` plus an advanced mode for free-form UVL expressions (`& | ! => <=>`)
- Multi-selection (drag box or Shift+click) with context menu: bulk delete, copy / paste, group / ungroup, change type / parent relation, align, distribute
- Bidirectional highlighting between the UVL code view and the diagram (click a feature name or relation keyword to select it on the canvas, and vice versa)
- Undo / redo (⌘Z / ⇧⌘Z), search palette (⌘K), fit view (⌘0), duplicate (⌘D)
- Autosave to localStorage with a "Saved · Xs ago" indicator
- Export **SVG / PNG / JPG / PDF** with optional transparent background, legend and constraints block. PDF is true vector with embedded Inter / JetBrains Mono so it stays crisp at any zoom — ready for LaTeX / Overleaf
- Import / export **UVL** (the eShop example from the UVL paper is loaded by default)

## Project structure
- `src/app/` — Next.js App Router entry points
- `src/components/` — `Canvas`, `Sidebar`, `FeatureNode`, `FeatureEdge`, `GroupArcs`, `EdgeMarkers`, `ContextMenu`, `SearchPalette`, `UvlCodeView`, `TabBar`
- `src/lib/store.ts` — Zustand store (model, history, clipboard, tabs)
- `src/lib/uvl.ts` — UVL exporter
- `src/lib/uvlParser.ts` — UVL importer
- `src/lib/constraintParser.ts` — visual/advanced constraint parsing
- `src/lib/layout.ts` — tidy-tree auto-layout
- `src/lib/exporter.ts` — SVG / PNG / JPG / PDF export
