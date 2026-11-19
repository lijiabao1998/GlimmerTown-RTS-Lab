// R092 卡車（44）、半履帶車（45）的造型：借用坦克共用的車體、砲塔兩個網格（R044、R140、R142 的做法），只改縮放，不多一次繪製呼叫。
// hull／top＝[長, 高, 寬]；fwd＝上層往前挪多少格；casemate＝上層不轉（跟著車頭）。專用的網格是之後的美術卡。
export const TRANSPORT_ART = {
  44: { hull: [1.0, 0.62, 0.52] as [number, number, number], top: [0.34, 0.95, 0.5] as [number, number, number], fwd: 0.24, casemate: true },    // 卡車：長、窄的車身，前面一個高的駕駛室
  45: { hull: [1.02, 0.5, 0.62] as [number, number, number], top: [0.62, 0.42, 0.58] as [number, number, number], fwd: -0.06, casemate: true },   // 半履帶車：低而長，上面一個扁平的戰鬥室
};
