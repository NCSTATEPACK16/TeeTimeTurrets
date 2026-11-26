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
  /**
   * One oversized flag on every pin (env/holeFlags.ts). Colours are Clubhouse Sunset (ui/theme.css):
   * ink #142018, cream #fff4dc, clay #c84b31.
   */
  flags: {
    /** Base-anchored at the pin. `segments` is radial. */
    pole: { height: 4, radius: 0.04, segments: 10, color: '#f7f5ee', roughness: 0.45 },
    /** The ink band at the foot of the pole, a little proud of it so it reads from the fairway. */
    ferrule: { bottom: 0.1, height: 0.18, radius: 0.047, color: '#142018' },
    /** Hung from the pole by its left edge, `topGap` below the pole's top. */
    cloth: { width: 1.6, height: 1.1, segmentsX: 16, segmentsY: 8, topGap: 0.04, roughness: 0.85 },
    /**
     * The cloth's wave: a fixed cycle on the renderer's clock (TSL `time`), not a wind system. The
     * displacement grows from 0 at the pole to `amplitude` (m) at the free edge; `waves` crests span
     * the cloth and travel outward at `rate` radians per second. Each flag starts at its own phase.
     */
    wave: { amplitude: 0.12, waves: 1.1, rate: 2.4 },
    /**
     * Knock-over, checked every fixed step: no collider, so the cart is never blocked. A standing flag
     * falls when the cart's centre is within `reachM` of the pole (horizontally, and within the pole's
     * height vertically) and moving faster than `minSpeed` m/s. It tips away from the cart over
     * `fallS`, starts to stand up `standAfterS` after the knock and is upright `riseS` later.
     * The fall angle is chosen so the pole's top rests on the ground, within `minFallDeg`..`maxFallDeg`.
     */
    knock: { reachM: 1.5, minSpeed: 1, fallS: 0.4, standAfterS: 4, riseS: 0.6, minFallDeg: 60, maxFallDeg: 100 },
    /** No pin may be nearer than this to the spawn or a qa pose (test/env/holeFlags.test.ts). */
    clearM: 10,
    /**
     * The cloth face: one canvas atlas for all 18 holes. A cell keeps the cloth's 1.6 : 1.1 aspect.
     * Sizes and positions are canvas pixels inside a cell.
     */
    face: {
      atlas: { width: 2048, height: 1024, cols: 6, cellW: 341, cellH: 234 },
      cloth: '#c84b31',
      border: { inset: 9, width: 6, color: '#fff4dc' },
      /** The compact mark (the logo's #mark view), on the hoist side. */
      logo: { x: 16, size: 120 },
      /** The number is most of the cloth's height, so it reads from about 60 m. */
      number: { font: '400 170px Shrikhand', x: 238, y: 154, maxWidth: 188, fill: '#fff4dc', outline: '#142018', outlineWidth: 16 },
      par: { font: '700 34px Rubik', x: 238, y: 208, fill: '#fff4dc' },
      anisotropy: 4,
    },
  },
  /** A tee sign at every tee (env/teeSigns.ts), a port of Turrets' src/render/teeSigns.ts. */
  teeSigns: {
    /** Beside the tee: `sideM` across the hole's line and `backM` behind the tee, on the side farther from a cart path. */
    sideM: 5,
    backM: 1.5,
    /** The face is inset this far (m) from each edge of the board. */
    faceInset: 0.025,
    /** And sits this far (m) proud of the board's front. */
    faceProud: 0.003,
    roughness: 0.85,
    face: {
      atlas: { width: 1024, height: 512, cols: 6, cellW: 170, cellH: 119 },
      anisotropy: 4,
      background: '#1e4d2b',
      border: { inset: 5, width: 4, color: '#fff4dc' },
      text: '#fff4dc',
      /** [font, y] for HOLE n, PAR p and N YDS. */
      lines: [
        ['400 36px Shrikhand', 38],
        ['700 24px Rubik', 74],
        ['700 24px Rubik', 99],
      ] as [string, number][],
    },
  },
} as const;
