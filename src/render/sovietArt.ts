// Procedural silhouettes share existing instanced meshes; no extra materials or draw calls.
export const SOVIET_ART: Record<number, { hull: [number, number, number]; top: [number, number, number]; fwd: number; casemate: boolean }> = {
  12: { hull: [0.95, 0.7, 0.7], top: [0.7, 0.85, 0.65], fwd: 0.04, casemate: false },
  13: { hull: [0.8, 0.85, 0.7], top: [0.65, 1.0, 0.65], fwd: 0.07, casemate: false },
  14: { hull: [1.06, 0.85, 1.0], top: [0.95, 0.95, 0.95], fwd: 0.06, casemate: false },
  15: { hull: [1.06, 0.85, 1.0], top: [1.2, 1.12, 1.08], fwd: 0.04, casemate: false },
  16: { hull: [1.2, 1.05, 1.2], top: [1.02, 1.4, 1.15], fwd: -0.02, casemate: false },
  17: { hull: [1.22, 0.95, 1.15], top: [1.5, 1.22, 1.15], fwd: -0.03, casemate: false },
  18: { hull: [0.95, 0.7, 0.72], top: [1.05, 0.55, 0.85], fwd: -0.06, casemate: true },
  19: { hull: [1.08, 0.8, 1.0], top: [1.4, 0.65, 1.15], fwd: 0.08, casemate: true },
  20: { hull: [1.2, 0.8, 1.2], top: [1.15, 0.95, 1.45], fwd: 0.08, casemate: true },
};
export const SOVIET_GUNS: Record<number, [number, number, number]> = { 21: [1.08, 0.6, 0.8], 22: [1.1, 1.1, 1.1] };
