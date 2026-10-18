// R105：布陣資訊讀取與模擬相同的材質與耐久規則。
import { bldMaterial, BLD_MATERIAL_NAMES, bldMaxHp } from '../sim/world.ts';
export function materialBuildDetail(kind: number, w: number, d: number, floors: number): string {
  return `${BLD_MATERIAL_NAMES[bldMaterial(kind)]} · 耐久 ${bldMaxHp(kind, w, d, floors)}`;
}
