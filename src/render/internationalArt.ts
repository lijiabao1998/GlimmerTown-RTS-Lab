// Distinct procedural profiles; existing hull/turret/gun instance batches only.
export const INTERNATIONAL_ART = {
  23: { hull: [0.82, 0.9, 0.78], top: [0.75, 1.0, 0.72], fwd: 0.02, casemate: false },
  24: { hull: [1.05, 1.12, 1.0], top: [0.95, 1.2, 1.0], fwd: 0.02, casemate: false },
  25: { hull: [1.05, 1.12, 1.0], top: [1.25, 1.1, 0.96], fwd: 0.04, casemate: false },
  26: { hull: [0.98, 0.68, 0.86], top: [1.4, 0.65, 0.9], fwd: 0.0, casemate: false },
  27: { hull: [1.12, 1.0, 1.05], top: [0.9, 0.65, 1.2], fwd: 0.05, casemate: true },
  29: { hull: [0.8, 0.7, 0.68], top: [0.6, 0.85, 0.6], fwd: 0.03, casemate: false },
  30: { hull: [1.06, 0.85, 0.96], top: [1.2, 0.9, 1.0], fwd: -0.03, casemate: false },
  31: { hull: [1.28, 0.82, 1.12], top: [1.5, 0.9, 1.1], fwd: 0.08, casemate: false },
  32: { hull: [1.3, 1.12, 1.3], top: [1.4, 1.3, 1.22], fwd: 0, casemate: false },
  33: { hull: [1.05, 0.65, 0.92], top: [1.1, 0.5, 1.2], fwd: 0.1, casemate: true },
  35: { hull: [0.7, 0.75, 0.66], top: [0.65, 0.9, 0.62], fwd: -0.04, casemate: false },
  36: { hull: [0.95, 0.8, 0.8], top: [0.7, 1.05, 0.85], fwd: -0.03, casemate: false },
  37: { hull: [0.95, 0.8, 0.8], top: [1.05, 1.0, 0.9], fwd: 0.02, casemate: false },
  38: { hull: [1.02, 0.88, 0.9], top: [1.0, 1.1, 0.92], fwd: 0.04, casemate: false },
  39: { hull: [0.96, 0.8, 0.84], top: [1.2, 0.65, 1.0], fwd: 0.08, casemate: true },
} satisfies Record<number, { hull: [number, number, number]; top: [number, number, number]; fwd: number; casemate: boolean }>;
export const INTERNATIONAL_GUN_ART: Record<number, [number, number, number]> = { 28: [0.85, 0.55, 0.75], 34: [1.4, 0.62, 0.95], 40: [1.05, 0.78, 0.88] };
