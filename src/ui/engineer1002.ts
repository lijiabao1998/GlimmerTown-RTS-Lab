// R1002 步兵支援兵器（二）：生產列 R142 分組選單裡「步兵支援」那一組再加兩項。有沒有看這一頁的閥（main.ts），能不能按看世界的 sw（productionBlockReason）。
import { UK_ENGINEER, UK_FLAME, UNIT_KINDS } from '../sim/world.ts';
export const eng1002Items = () => [
  { kind: UK_ENGINEER, label: '工兵', cost: UNIT_KINDS[UK_ENGINEER].cost, group: '步兵支援', role: '工兵 · 四人，點房子、碉堡＝貼著放炸藥（碉堡不打折），點鐵絲網＝剪開；怕機槍與步兵' },
  { kind: UK_FLAME, label: '火焰噴射', cost: UNIT_KINDS[UK_FLAME].cost, group: '步兵支援', role: '火焰噴射器 · 兩人，兩格內燒得進房子、碉堡、壕溝，不吃掩護；可停火埋伏／怕兩格外的一切' },
];
