
import { SimulationConfig } from './types';

export const DEFAULT_CONFIG: SimulationConfig = {
  resolution: 128, // Grid size (N x N)
  viscosity: 0.00001, // Fluid thickness
  diffusion: 0.0, // Set to 0 to keep smoke crisp and prevent "thinning out" invisibility
  fadeRate: 0, // Set to 0 so smoke stays indefinitely
  iterations: 10, // Solver steps
  dyeRes: 256 // Render resolution
};

export const CANVAS_BG_COLOR = '#000000';
export const SMOKE_COLOR = { r: 255, g: 255, b: 255 };
