export type FeatureType = "Boolean" | "Integer" | "Float" | "String";

export type Attribute = { key: string; value: string };

export type FeatureNodeData = {
  name: string;
  featureType: FeatureType;
  abstract?: boolean;
  attributes: Attribute[];
  /** relationship with parent (only meaningful for non-root) */
  parentRel: "mandatory" | "optional";
  /** if parent puts it in a group, edge marker is hidden and group arc is drawn */
  inGroup?: boolean;
  /** Feature cardinality [n..m], optional */
  cardinality?: { lower: number; upper: number };
};

export type GroupType = "and" | "or" | "alternative" | "cardinality";

export type Group = {
  id: string;
  parentId: string;
  childrenIds: string[];
  type: GroupType;
  cardinality?: { lower: number; upper: number };
};

export type ConstraintRoute = {
  /** Y coordinate of the horizontal lane below the tree. */
  laneY?: number;
  /** X offset from source node center where the line exits downward. */
  sourceX?: number;
  /** X offset from target node center where the line enters upward. */
  targetX?: number;
};

export type Constraint = { id: string; expr: string; route?: ConstraintRoute };
