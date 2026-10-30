import { AMERICAN_KINDS, GERMAN_KINDS, JAPANESE_KINDS, UNIT_KINDS } from '../sim/world.ts';
const groups = [
  { name: '美式裝備', kinds: AMERICAN_KINDS, labels: ['M3', 'M4', 'M4/76', 'M18', 'M7', 'M1砲'], roles: ['快速偵察／薄裝甲', '均衡中坦／支援步兵', '長砲中坦／較慢裝填', '高速反坦克／開頂脆弱', '機動曲射／最小射程', '輕型反坦克砲／需架設'] },
  { name: '德式裝備', kinds: GERMAN_KINDS, labels: ['Pz II', 'Pz IV', '豹式', '虎式', 'StuG', 'PaK40'], roles: ['快速連射／弱反裝甲', '長砲中坦／均衡成本', '遠射強甲／高造價', '重裝打擊／慢且昂貴', '低矮突擊砲／停車開火', '遠程反坦克砲／移動慢'] },
  { name: '日式裝備', kinds: JAPANESE_KINDS, labels: ['九五式', '九七式', '新砲塔', '一式', 'Ho-Ni', '九〇砲'], roles: ['廉價機動／薄裝甲', '近距支援／弱反裝甲', '快裝反坦克／拆屋弱', '加強防護／中型支援', '開頂反坦克／必須停車', '多用途野砲／薄弱'] },
];
export const internationalItems = () => groups.flatMap(g => g.kinds.map((kind, i) => ({ kind, label: g.labels[i], cost: UNIT_KINDS[kind].cost, group: g.name, role: `${UNIT_KINDS[kind].name} · ${g.roles[i]}` })));
