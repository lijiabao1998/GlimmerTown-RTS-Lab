// R063 小畫家共用的介面：畫面（BattleView）建網格、提供插值位置與「看不看得到」，小畫家只管自己那一種東西。
import type * as THREE from 'three';
import type { Unit } from '../sim/world.ts';

/** BattleView 建實例網格的那一個函式：建好就加進場景（建的先後＝場景順序＝畫的順序） */
export type MakeInst = (g: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow: boolean) => THREE.InstancedMesh;

/** 小畫家向畫面問的事（呼叫時都經過畫面本身，守衛換掉畫面上的方法照樣有效） */
export interface Sight {
  visibleAt(x: number, z: number): boolean;
  visibleUnit(u: Unit): boolean;
  unitHeight(u: Unit): number;
}

/** 單位這一幀畫在哪：上一步與這一步之間插值（跟畫單位用同一組陣列與 alpha） */
export interface Lerp { prevX: Float64Array; prevZ: Float64Array; alpha: number }
