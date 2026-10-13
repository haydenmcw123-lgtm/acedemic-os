// Types for house-data.json — the single source of truth for the walkthrough.
// Units are feet. +x = east, -z = north, +y = up. The lake is to the west (x < 0).

/** [x0, z0, x1, z1] in plan, x0 < x1 and z0 < z1. */
export type Rect = [number, number, number, number];
export type Axis = 'x' | 'z';
export type LevelIndex = 0 | 1 | 2;

export type FloorKind = 'hickory' | 'tile' | 'slate' | 'rubber' | 'turf' | 'concrete';
export type WallKind = 'plaster' | 'tilewall' | 'stone' | 'paneling' | 'theater' | 'drywall';

export interface Room {
  id: string;
  level: LevelIndex;
  name: string;
  rects: Rect[];
  floor?: FloorKind;
  wall?: WallKind;
  /** Open to the roof above (no ceiling at this level). */
  noCeil?: boolean;
  /** Upper-level airspace of a double-height room; owns plan cells but has no floor. */
  void?: boolean;
  stair?: boolean;
  /** Caption shown on entry. */
  meta?: string;
}

/** A span of a grid line with no wall (open plan). `rail` puts a guard rail there instead. */
export interface OpenSpan {
  level: LevelIndex;
  /** 'x' = the line x = at, running along z from..to. 'z' = the line z = at, running along x. */
  axis: Axis;
  at: number;
  from: number;
  to: number;
  rail?: boolean;
}

export type OpeningKind =
  | 'door' | 'front' | 'window' | 'glass' | 'slide' | 'fold' | 'glassdoor'
  | 'open' | 'bookcase' | 'gdoor' | 'fireplace';

export interface Opening {
  level: LevelIndex;
  axis: Axis;
  at: number;
  from: number;
  to: number;
  kind: OpeningKind;
  /** Height of the bottom of the opening above the floor (ft). */
  sill?: number;
  /** Height of the top of the opening above the floor (ft). */
  head?: number;
}

export interface LevelInfo {
  level: LevelIndex;
  name: string;
  floorY: number;
  ceiling: number;
  wallHeight: number;
}

export interface FurnitureItem {
  name: string;
  /** Plan position of the footprint center. */
  x: number;
  z: number;
  /** Rotation about +y, degrees. */
  rotDeg: number;
  /** [w, h, d] box the model must fit, in the item's unrotated frame. */
  size: [number, number, number];
  /** Base height when not sitting on its room's floor (wall art, uppers, exterior). */
  y?: number;
  /** Cabinets, island, vanities, closets… always present, even with staging set to Empty. */
  builtIn?: boolean;
}

export interface TourStop {
  x: number;
  z: number;
  dwellSec?: number;
  /** [x, z, y] look target; y is relative to the camera's floor. */
  lookAt?: [number, number, number];
  label?: string;
}

export interface StairSpec {
  hall: Rect;
  flightA: { x0: number; x1: number; z0: number; z1: number };
  landing: Rect;
  flightB: { x0: number; x1: number; z0: number; z1: number };
  riserIn: number;
  treadIn: number;
}

export interface RailSpec { axis: Axis; at: number; from: number; to: number }
export interface DeckSpec {
  id: string;
  name: string;
  rect: Rect;
  y: number;
  covered?: boolean;
  posts?: { x: number; z: number[] };
  privacyScreen?: RailSpec;
  rails: RailSpec[];
}
export interface FlightSpec { axis: Axis; from: number; to: number; y0: number; y1: number; cross?: [number, number] }
export interface SiteSpec {
  decks: DeckSpec[];
  terrace: { rect: Rect; y: number };
  pool: { rect: Rect; depth: number; vanishingEdge: 'west' };
  entry: { walk: Rect; y: number; canopy: Rect; piers: [number, number][] };
  driveway: { rect: Rect; y: number };
  bluffStairs: { width: [number, number]; flights: FlightSpec[]; landings: { rect: Rect; y: number }[] };
  dock: { rects: Rect[]; y: number; roof: { x: [number, number]; z: [number, number]; ridgeY: number } };
  lake: { y: number; farShoreX: number };
}

export interface HouseData {
  name: string;
  location: { name: string; lat: number; lon: number; date: string; timeZone: string };
  units: 'feet';
  levels: LevelInfo[];
  wallThickness: number;
  rooms: Room[];
  opens: OpenSpan[];
  openings: Opening[];
  stair: StairSpec;
  outdoorAreas: Record<string, string>;
  site: SiteSpec;
  furnitureByRoom: Record<string, FurnitureItem[]>;
  tourStops: TourStop[];
}
