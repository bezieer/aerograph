
// A lightweight implementation of Real-Time Fluid Dynamics for Games by Jos Stam
// Adapted for TypeScript and React context

export class FluidSolver {
  size: number;
  dt: number;
  diff: number;
  visc: number;
  
  s: Float32Array; // Density (smoke)
  density: Float32Array; // Current Density
  
  Vx: Float32Array; // Velocity X
  Vy: Float32Array; // Velocity Y
  Vx0: Float32Array; // Previous Velocity X
  Vy0: Float32Array; // Previous Velocity Y

  constructor(size: number, diffusion: number, viscosity: number, dt: number) {
    this.size = size;
    this.dt = dt;
    this.diff = diffusion;
    this.visc = viscosity;
    
    const N = size;
    const arraySize = (N + 2) * (N + 2);
    
    this.s = new Float32Array(arraySize);
    this.density = new Float32Array(arraySize);
    this.Vx = new Float32Array(arraySize);
    this.Vy = new Float32Array(arraySize);
    this.Vx0 = new Float32Array(arraySize);
    this.Vy0 = new Float32Array(arraySize);
  }

  // Add density at a specific coordinate
  addDensity(x: number, y: number, amount: number) {
    const N = this.size;
    const index = this.IX(x, y);
    this.density[index] += amount;
    // Removed clamping to 255 to allow high density accumulation. 
    // This prevents smoke from "disappearing" when it diffuses over a large area.
    // Visual rendering clamps to 255 automatically via Uint8ClampedArray.
  }

  // Add velocity at a specific coordinate
  addVelocity(x: number, y: number, amountX: number, amountY: number) {
    const index = this.IX(x, y);
    this.Vx[index] += amountX;
    this.Vy[index] += amountY;
  }

  // Coordinate flattening
  IX(x: number, y: number) {
    const N = this.size;
    // Clamp coordinates
    x = Math.max(0, Math.min(x, N + 1));
    y = Math.max(0, Math.min(y, N + 1));
    return x + (N + 2) * y;
  }

  // Simulation Step
  step(iter: number, fadeRate: number) {
    const N = this.size;
    const visc = this.visc;
    const diff = this.diff;
    const dt = this.dt;
    const Vx = this.Vx;
    const Vy = this.Vy;
    const Vx0 = this.Vx0;
    const Vy0 = this.Vy0;
    const s = this.s;
    const density = this.density;

    this.diffuse(1, Vx0, Vx, visc, dt, iter);
    this.diffuse(2, Vy0, Vy, visc, dt, iter);
    
    this.project(Vx0, Vy0, Vx, Vy, iter);
    
    this.advect(1, Vx, Vx0, Vx0, Vy0, dt);
    this.advect(2, Vy, Vy0, Vx0, Vy0, dt);
    
    this.project(Vx, Vy, Vx0, Vy0, iter);
    
    this.diffuse(0, s, density, diff, dt, iter);
    this.advect(0, density, s, Vx, Vy, dt);

    // Natural dissipation (fade out)
    if (fadeRate > 0) {
      for (let i = 0; i < density.length; i++) {
          density[i] = Math.max(0, density[i] * (1 - fadeRate));
      }
    }
  }

  lin_solve(b: number, x: Float32Array, x0: Float32Array, a: number, c: number, iter: number) {
    const N = this.size;
    const cRecip = 1.0 / c;
    
    for (let k = 0; k < iter; k++) {
      for (let j = 1; j <= N; j++) {
        for (let i = 1; i <= N; i++) {
          x[this.IX(i, j)] =
            (x0[this.IX(i, j)] +
              a *
                (x[this.IX(i + 1, j)] +
                  x[this.IX(i - 1, j)] +
                  x[this.IX(i, j + 1)] +
                  x[this.IX(i, j - 1)])) *
            cRecip;
        }
      }
      this.set_bnd(b, x);
    }
  }

  diffuse(b: number, x: Float32Array, x0: Float32Array, diff: number, dt: number, iter: number) {
    const N = this.size;
    const a = dt * diff * (N - 2) * (N - 2);
    this.lin_solve(b, x, x0, a, 1 + 6 * a, iter);
  }

  project(velocX: Float32Array, velocY: Float32Array, p: Float32Array, div: Float32Array, iter: number) {
    const N = this.size;
    
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        div[this.IX(i, j)] =
          (-0.5 *
            (velocX[this.IX(i + 1, j)] -
              velocX[this.IX(i - 1, j)] +
              velocY[this.IX(i, j + 1)] -
              velocY[this.IX(i, j - 1)])) /
          N;
        p[this.IX(i, j)] = 0;
      }
    }
    
    this.set_bnd(0, div);
    this.set_bnd(0, p);
    this.lin_solve(0, p, div, 1, 6, iter); // Simplified relaxation
    
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        velocX[this.IX(i, j)] -= 0.5 * N * (p[this.IX(i + 1, j)] - p[this.IX(i - 1, j)]);
        velocY[this.IX(i, j)] -= 0.5 * N * (p[this.IX(i, j + 1)] - p[this.IX(i, j - 1)]);
      }
    }
    
    this.set_bnd(1, velocX);
    this.set_bnd(2, velocY);
  }

  advect(b: number, d: Float32Array, d0: Float32Array, velocX: Float32Array, velocY: Float32Array, dt: number) {
    const N = this.size;
    let i0, i1, j0, j1;
    
    let x, y, s0, t0, s1, t1;
    // Time step scalar
    const dt0 = dt * (N - 2);

    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        x = i - dt0 * velocX[this.IX(i, j)];
        y = j - dt0 * velocY[this.IX(i, j)];
        
        if (x < 0.5) x = 0.5;
        if (x > N + 0.5) x = N + 0.5;
        i0 = Math.floor(x);
        i1 = i0 + 1;
        
        if (y < 0.5) y = 0.5;
        if (y > N + 0.5) y = N + 0.5;
        j0 = Math.floor(y);
        j1 = j0 + 1;
        
        s1 = x - i0;
        s0 = 1.0 - s1;
        t1 = y - j0;
        t0 = 1.0 - t1;
        
        d[this.IX(i, j)] =
          s0 * (t0 * d0[this.IX(i0, j0)] + t1 * d0[this.IX(i0, j1)]) +
          s1 * (t0 * d0[this.IX(i1, j0)] + t1 * d0[this.IX(i1, j1)]);
      }
    }
    this.set_bnd(b, d);
  }

  set_bnd(b: number, x: Float32Array) {
    const N = this.size;
    
    // Handle edges
    for (let i = 1; i <= N; i++) {
      x[this.IX(i, 0)] = b === 2 ? -x[this.IX(i, 1)] : x[this.IX(i, 1)];
      x[this.IX(i, N + 1)] = b === 2 ? -x[this.IX(i, N)] : x[this.IX(i, N)];
    }
    for (let j = 1; j <= N; j++) {
      x[this.IX(0, j)] = b === 1 ? -x[this.IX(1, j)] : x[this.IX(1, j)];
      x[this.IX(N + 1, j)] = b === 1 ? -x[this.IX(N, j)] : x[this.IX(N, j)];
    }
    
    // Handle corners
    x[this.IX(0, 0)] = 0.5 * (x[this.IX(1, 0)] + x[this.IX(0, 1)]);
    x[this.IX(0, N + 1)] = 0.5 * (x[this.IX(1, N + 1)] + x[this.IX(0, N)]);
    x[this.IX(N + 1, 0)] = 0.5 * (x[this.IX(N, 0)] + x[this.IX(N + 1, 1)]);
    x[this.IX(N + 1, N + 1)] = 0.5 * (x[this.IX(N, N + 1)] + x[this.IX(N + 1, N)]);
  }
}
