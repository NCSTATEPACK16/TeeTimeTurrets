/** Gray-box look for M0. M3 replaces this with the physical sky, PBR ground and quality tiers. */
export const envConfig = {
  /** Sky is the water shader's own cheap atmosphere (env/oceanWaves.ts) so reflections match it; fog fades to it. */
  fog: { near: 180, far: 1100 },
  hemisphere: { sky: '#d6e8ff', ground: '#4e5b33', intensity: 1.4 },
  /** Morning sun from the east-southeast (compass degrees). */
  sun: { color: '#fff0d8', intensity: 2.4, azimuthDeg: 115, elevationDeg: 32, distance: 400 },
  exposure: 1.0,
  maxPixelRatio: 2,
  terrain: {
    chunkCells: 128,
    roughness: 0.95,
    wireframeColor: '#1b2a14',
    /**
     * Distance LOD per chunk (three's LOD, measured from the chunk center): node stride and the
     * camera distance in meters where it starts. Stride 1 is the collider surface exactly.
     */
    lod: [
      { stride: 1, distance: 0 },
      { stride: 2, distance: 170 },
      { stride: 4, distance: 380 },
    ],
    /** Fraction of a level's distance the camera must pass before switching back (avoids popping at the line). */
    lodHysteresis: 0.05,
    /** Depth in meters of the skirt under every chunk edge that hides LOD cracks. */
    skirtDepth: 3,
  },
  /** PRD High-tier render budget (M2 checks the terrain against it; M3 adds tiers). */
  renderBudget: { triangles: 2_000_000, drawCalls: 300 },
  /** The visual-only skirt beyond the course (terrain/horizon.ts): one muted woodland color for now (M3 shades it). */
  /** `stride` draws every Nth skirt node (2 = 20 m cells on the 10 m packet grid). */
  horizon: { color: '#3d4a2c', stride: 2 },
  /**
   * All water uses the port of afl_ext's Shadertoy ocean (MdXyzX) in env/oceanWaves.ts.
   * Shader defaults are drag 0.38, timeScale 1, 36 normal iterations, distanceSmoothing 0.8.
   */
  water: {
    /** Wave units per meter. The shader's base wave is 2π units long, so 2.5 gives ~2.5 m wind ripples. */
    waveScale: 2.5,
    /** Crest-to-trough height in meters (the shader's WATER_DEPTH). Calmer below, choppier above. */
    waveHeight: 0.06,
    /** How strongly each wave drags the next one's sample point (DRAG_MULT). */
    drag: 0.38,
    /** Multiplies the shader's clock. */
    timeScale: 1.0,
    /** Wave octaves summed for the normal (ITERATIONS_NORMAL); compile-time. */
    normalIterations: 36,
    /** How far the normal flattens toward +Y with distance, against shimmer (the shader's 0.8). */
    distanceSmoothing: 0.8,
    /**
     * Light scattered up out of the water, brighter on crests. The default is the shader's deep-ocean
     * navy at its 0.1 strength; seen from high up it reads near-black. A greener or browner pond is this.
     */
    scatterColor: [0.0293, 0.0698, 0.1717] as [number, number, number],
    scatterStrength: 0.1,
    /** The shader's C * 2.0, rescaled for three's ACES Filmic (which already multiplies by 1/0.6). */
    exposure: 1.2,
  },
  /** Tree colors; dimensions live in level/treeConfig.ts, shared with the trunk colliders. */
  trees: { trunkColor: '#5a4632', pineColor: '#2f4a26', oakColor: '#3f5f2a' },
  cart: { body: '#ece8de', roof: '#f4f2ec', seat: '#3b3b3b', tire: '#202020', hub: '#9a9a9a' },
} as const;
