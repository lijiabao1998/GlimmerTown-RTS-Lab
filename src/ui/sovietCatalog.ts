import { SOVIET_KINDS, UNIT_KINDS } from '../sim/world.ts';
export const SOVIET_ROLES = ['快速偵察／薄裝甲', '輕型護衛／短射程', '機動中坦／均衡火力', '長砲中坦／較慢裝填', '重裝突破／緩慢', '重型打擊／長裝填', '開頂支援／怕步兵', '停車反坦克／弱反步兵', '重型破城／必須停車', '牽引多用途砲／薄弱', '間接拆屋／最小射程'];
export const sovietItems = () => SOVIET_KINDS.map((kind, i) => ({ kind, label: UNIT_KINDS[kind].name, cost: UNIT_KINDS[kind].cost, group: i < 6 ? '蘇式坦克' : '蘇式支援', role: SOVIET_ROLES[i] }));
