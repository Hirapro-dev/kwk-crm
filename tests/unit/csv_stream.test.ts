import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { streamCsv } from '../../scripts/migrate/lib/csv_stream';

describe('streamCsv', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'csvstream-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('単純なCSVを行ごとに処理する', async () => {
    const f = join(dir, 'simple.csv');
    writeFileSync(f, 'a,b,c\n1,2,3\n4,5,6\n', 'utf-8');
    const rows: Record<string, string>[] = [];
    const n = await streamCsv(f, (r) => {
      rows.push(r);
    });
    expect(n).toBe(2);
    expect(rows[0]).toEqual({ a: '1', b: '2', c: '3' });
    expect(rows[1]).toEqual({ a: '4', b: '5', c: '6' });
  });

  it('UTF-8 BOM を除去する', async () => {
    const f = join(dir, 'bom.csv');
    writeFileSync(f, '\uFEFFa,b\n1,2\n', 'utf-8');
    const rows: Record<string, string>[] = [];
    await streamCsv(f, (r) => {
      rows.push(r);
    });
    expect(rows[0]).toEqual({ a: '1', b: '2' });
  });

  it('クォート内のカンマを尊重する', async () => {
    const f = join(dir, 'quoted.csv');
    writeFileSync(f, 'a,b\n"x,y",z\n', 'utf-8');
    const rows: Record<string, string>[] = [];
    await streamCsv(f, (r) => {
      rows.push(r);
    });
    expect(rows[0]).toEqual({ a: 'x,y', b: 'z' });
  });

  it('クォート内の改行を行をまたいで結合する(CSV内改行)', async () => {
    const f = join(dir, 'multiline.csv');
    writeFileSync(f, 'a,b\n"line1\nline2",end\n', 'utf-8');
    const rows: Record<string, string>[] = [];
    await streamCsv(f, (r) => {
      rows.push(r);
    });
    expect(rows[0]).toEqual({ a: 'line1\nline2', b: 'end' });
  });

  it('エスケープされたダブルクォート(""")', async () => {
    const f = join(dir, 'escape.csv');
    writeFileSync(f, 'a\n"he said ""hi"""\n', 'utf-8');
    const rows: Record<string, string>[] = [];
    await streamCsv(f, (r) => {
      rows.push(r);
    });
    expect(rows[0]).toEqual({ a: 'he said "hi"' });
  });

  it('空行はスキップする', async () => {
    const f = join(dir, 'empty.csv');
    writeFileSync(f, 'a,b\n1,2\n\n3,4\n', 'utf-8');
    const rows: Record<string, string>[] = [];
    const n = await streamCsv(f, (r) => {
      rows.push(r);
    });
    expect(n).toBe(2);
    expect(rows[1]).toEqual({ a: '3', b: '4' });
  });
});
