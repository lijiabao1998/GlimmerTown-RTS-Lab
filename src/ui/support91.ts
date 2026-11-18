// R091 步兵支援兵器（一）：生產列 R142 分組選單裡的「步兵支援」一組。那一組有沒有看這一頁的閥（main.ts），能不能按看世界的 sw（productionBlockReason）。
import { UK_SNIPER, UK_AT91, UNIT_KINDS } from '../sim/world.ts';
export const support91Items = () => [
  { kind: UK_SNIPER, label: '狙擊手', cost: UNIT_KINDS[UK_SNIPER].cost, group: '步兵支援', role: '狙擊手 · 兩人，遠射先打觀測員與砲組；可進房子／怕觀測員加砲兵' },
  { kind: UK_AT91, label: '反戰車組', cost: UNIT_KINDS[UK_AT91].cost, group: '步兵支援', role: '反戰車小組 · 三格內打車，打側面、後面更容易穿；可停火埋伏／怕步兵與機槍' },
];
