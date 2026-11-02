import { describe, expect, it } from 'vitest';
import {
  addConditionTo,
  addGroupTo,
  countFilterConditions,
  describeFilterGroup,
  emptyFilterGroup,
  filterGroupFromDefinition,
  moveConditionTo,
  moveTargets,
  normalizeFilterGroup,
  removeItemAt,
  setGroupLogic,
  updateConditionAt,
} from '../../lib/reports/filter_tree';
import type { ReportFilterCondition, ReportFilterGroup } from '../../lib/reports/types';

const A: ReportFilterCondition = { field: 'members.name', op: 'contains', value: 'A' };
const B: ReportFilterCondition = { field: 'members.phone1', op: 'is_null' };
const C: ReportFilterCondition = { field: 'members.total_amount', op: 'gte', value: '100' };

const label = (c: ReportFilterCondition) => String(c.value ?? c.field);

/** 画面の操作で「(A OR B) AND C」を組み立てる (グループを足して A・B を入れ、C は全体へ) */
function buildAOrBAndC(): ReportFilterGroup {
  let g = emptyFilterGroup('AND');
  g = addGroupTo(g, []);
  g = addConditionTo(g, [0], A);
  g = addConditionTo(g, [0], B);
  g = addConditionTo(g, [], C);
  return g;
}

describe('filterGroupFromDefinition(保存済みの定義の読み込み)', () => {
  it('未設定なら空の AND グループ', () => {
    expect(filterGroupFromDefinition(undefined)).toEqual({ logic: 'AND', conditions: [] });
  });

  it('入れ子のグループを落とさない(以前の画面はグループを捨てて保存し直していた)', () => {
    const saved: ReportFilterGroup = {
      logic: 'AND',
      conditions: [{ group: { logic: 'OR', conditions: [A, B] } }, C],
    };
    expect(filterGroupFromDefinition(saved)).toEqual(saved);
  });

  it('画面で扱わない values(in / between 用)も残す', () => {
    const inCond: ReportFilterCondition = {
      field: 'members.gender',
      op: 'in',
      values: ['男', '女'],
    };
    const g = filterGroupFromDefinition({ logic: 'AND', conditions: [inCond] });
    expect(g.conditions[0]).toEqual(inCond);
  });

  it('元の定義を書き換えない(複製を返す)', () => {
    const saved: ReportFilterGroup = { logic: 'AND', conditions: [{ ...A }] };
    const g = filterGroupFromDefinition(saved);
    const changed = updateConditionAt(g, [0], { value: 'Z' });
    expect(saved.conditions[0]).toEqual(A);
    expect(changed.conditions[0]).toMatchObject({ value: 'Z' });
  });
});

describe('グループの追加と条件の組み立て', () => {
  it('(A OR B) AND C を組み立てられる', () => {
    expect(buildAOrBAndC()).toEqual({
      logic: 'AND',
      conditions: [{ group: { logic: 'OR', conditions: [A, B] } }, C],
    });
  });

  it('グループの結合の既定は親の逆(全体が OR ならグループは AND)', () => {
    const g = addGroupTo(emptyFilterGroup('OR'), []);
    expect(g.conditions[0]).toEqual({ group: { logic: 'AND', conditions: [] } });
  });

  it('(A AND B) OR C: 全体とグループの結合を切り替えられる', () => {
    let g = buildAOrBAndC();
    g = setGroupLogic(g, [], 'OR');
    g = setGroupLogic(g, [0], 'AND');
    expect(describeFilterGroup(g, label)).toBe('(A AND members.phone1) OR 100');
  });

  it('条件の値を書き換えても他の項目(op・field)は保つ', () => {
    const g = updateConditionAt(buildAOrBAndC(), [0, 0], { value: 'X' });
    expect(g.conditions[0]).toEqual({
      group: { logic: 'OR', conditions: [{ ...A, value: 'X' }, B] },
    });
  });

  it('グループを指すパスで updateConditionAt しても何も変えない', () => {
    const g = buildAOrBAndC();
    expect(updateConditionAt(g, [0], { value: 'X' })).toEqual(g);
  });
});

describe('removeItemAt(削除)', () => {
  it('グループ内の条件を消せる', () => {
    const g = removeItemAt(buildAOrBAndC(), [0, 1]);
    expect(g.conditions[0]).toEqual({ group: { logic: 'OR', conditions: [A] } });
  });

  it('グループごと消せる', () => {
    expect(removeItemAt(buildAOrBAndC(), [0]).conditions).toEqual([C]);
  });

  it('範囲外のパスでは何も変えない', () => {
    const g = buildAOrBAndC();
    expect(removeItemAt(g, [5, 0])).toEqual(g);
  });
});

describe('moveConditionTo(条件をグループへ移す)', () => {
  it('全体の条件を後ろのグループへ移せる(A, B を足してから括る使い方)', () => {
    let g = emptyFilterGroup('AND');
    g = addConditionTo(g, [], A);
    g = addConditionTo(g, [], B);
    g = addConditionTo(g, [], C);
    g = addGroupTo(g, []); // [A, B, C, group]
    g = moveConditionTo(g, [0], [3]); // A → グループ。[B, C, group(A)]
    g = moveConditionTo(g, [0], [2]); // B → グループ。[C, group(A, B)]
    expect(g).toEqual({
      logic: 'AND',
      conditions: [C, { group: { logic: 'OR', conditions: [A, B] } }],
    });
  });

  it('グループの条件を全体へ戻せる(全体の末尾に付く)', () => {
    const g = moveConditionTo(buildAOrBAndC(), [0, 0], []);
    expect(g).toEqual({
      logic: 'AND',
      conditions: [{ group: { logic: 'OR', conditions: [B] } }, C, A],
    });
  });

  it('同じグループへの移動・グループ自体の移動・存在しない移動先は何も変えない', () => {
    const g = buildAOrBAndC();
    expect(moveConditionTo(g, [0, 0], [0])).toEqual(g);
    expect(moveConditionTo(g, [0], [])).toEqual(g);
    expect(moveConditionTo(g, [1], [1])).toEqual(g);
  });
});

describe('normalizeFilterGroup(保存・プレビューに渡す形)', () => {
  it('条件の無いグループは取り除く(空の括弧を SQL に作らない)', () => {
    const g = addGroupTo(addConditionTo(emptyFilterGroup(), [], C), []);
    expect(normalizeFilterGroup(g)).toEqual({ logic: 'AND', conditions: [C] });
  });

  it('条件が 1 つも無ければ undefined(フィルタなし)', () => {
    expect(normalizeFilterGroup(addGroupTo(emptyFilterGroup(), []))).toBeUndefined();
    expect(normalizeFilterGroup(emptyFilterGroup())).toBeUndefined();
  });

  it('条件のあるグループはそのまま残す', () => {
    const g = buildAOrBAndC();
    expect(normalizeFilterGroup(g)).toEqual(g);
  });
});

describe('件数・移動先・式の表示', () => {
  it('グループの中も数える', () => {
    expect(countFilterConditions(buildAOrBAndC())).toBe(3);
  });

  it('移動先は「全体」と全体の直下のグループ(番号は並び順)', () => {
    const g = addGroupTo(buildAOrBAndC(), []); // [group(A,B), C, group()]
    expect(moveTargets(g)).toEqual([
      { path: [], label: '全体' },
      { path: [0], label: 'グループ1' },
      { path: [2], label: 'グループ2' },
    ]);
  });

  it('式: 条件が 2 つ以上のグループだけ括弧で囲み、空のグループは省く', () => {
    let g = buildAOrBAndC();
    g = addGroupTo(g, []);
    expect(describeFilterGroup(g, label)).toBe('(A OR members.phone1) AND 100');
    g = removeItemAt(g, [0, 1]);
    expect(describeFilterGroup(g, label)).toBe('A AND 100');
    expect(describeFilterGroup(emptyFilterGroup(), label)).toBe('');
  });
});
