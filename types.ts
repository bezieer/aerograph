export enum ToolMode {
  SMOKE = 'SMOKE', // Adds density (white ink) and velocity
  WIND = 'WIND',   // Adds velocity only (transparent/interaction)
  ERASER = 'ERASER' // Removes density
}

export interface SimulationConfig {
  resolution: number;
  viscosity: number;
  diffusion: number;
  fadeRate: number; // How fast smoke disappears
  iterations: number; // Solver accuracy
  dyeRes: number; // Resolution of the dye grid relative to velocity
}

export interface GeminiAnalysisResult {
  title: string;
  description: string;
  mood: string;
}