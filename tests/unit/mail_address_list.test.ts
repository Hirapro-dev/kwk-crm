import { describe, expect, it } from 'vitest';
import { parseAddressList } from '../../lib/domain/mail_inbound';

/**
 * ヘッダーの To / Cc 行(複数宛先)をアドレスの配列にする(過去データ取込・宛先の補正用)。
 * メールディーラーの取込で「Toアドレス」列(受信箱のアドレス1つ)しか見ていなかったため、
 * フォーム通知に同送されていた他の宛先(旧「メール to リード」用アドレス等)が落ちていた。
 * ヘッダーの To 行から全宛先を決定論的に取り出せることをテストで固定する。
 */
describe('parseAddressList', () => {
  it('カンマ区切りの複数宛先を小文字のアドレス配列にする', () => {
    expect(parseAddressList('quest@kawaraban.co.jp, Y3AWTD-hirayama-p@hdbronze.htdb.jp')).toEqual([
      'quest@kawaraban.co.jp',
      'y3awtd-hirayama-p@hdbronze.htdb.jp',
    ]);
  });

  it('表示名付き(山括弧)や、表示名にカンマを含む引用符付きも扱える', () => {
    expect(
      parseAddressList('"投資の\\"KAWARA\\"版, 株式会社" <a@x.example>, B <b@y.example>'),
    ).toEqual(['a@x.example', 'b@y.example']);
  });

  it('空・未指定は空配列、重複は1つにする', () => {
    expect(parseAddressList('')).toEqual([]);
    expect(parseAddressList(null)).toEqual([]);
    expect(parseAddressList('a@x.example, A@X.example')).toEqual(['a@x.example']);
  });

  it('折り返しで入る余分な空白や末尾のカンマ、アドレスでない断片を無視する', () => {
    expect(parseAddressList(' a@x.example ,  b@y.example , ')).toEqual([
      'a@x.example',
      'b@y.example',
    ]);
    expect(parseAddressList('undisclosed-recipients:;')).toEqual([]);
  });
});
