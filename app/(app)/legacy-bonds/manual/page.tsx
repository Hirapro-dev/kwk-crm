/**
 * 旧社債管理 要件のまとめと使い方(CLAUDE.md §5.13c / §8.1)
 *
 * 旧社債管理を使う担当者向けの説明ページ。要件(計算式・継続年数と利率・今回の結果の意味・次の期のルール)と、
 * 画面の操作手順を画像付きでまとめる。画像は架空のデータで撮ったもの(public/manual/legacy-bonds/)。
 * 閲覧は admin のみ(旧社債管理と同じ)。内容は静的で DB は読まない。
 */

import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { LEGACY_BOND_RATES, LEGACY_BOND_YEAR_OPTIONS } from '@/lib/domain/legacy_bonds_calc';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

const IMG = '/manual/legacy-bonds';

const TOC = [
  { id: 'about', label: '1. この画面について' },
  { id: 'rules', label: '2. 要件のまとめ' },
  { id: 'flow', label: '3. 満期が来たときの流れ' },
  { id: 'list', label: '4. 一覧の見方' },
  { id: 'detail', label: '5. 詳細の見方' },
  { id: 'edit', label: '6. 編集する' },
  { id: 'continue', label: '7. 次の期を作成する' },
  { id: 'after', label: '8. 次の期を作った後' },
  { id: 'other', label: '9. 取込・削除' },
  { id: 'faq', label: '10. よくある質問' },
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-4 space-y-3 p-5">
      <h2 className="text-base font-bold">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed">{children}</div>
    </Card>
  );
}

function Shot({
  file,
  width,
  height,
  alt,
  caption,
  narrow,
}: {
  file: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  narrow?: boolean;
}) {
  return (
    <figure className={narrow ? 'max-w-[640px]' : undefined}>
      <Image
        src={`${IMG}/${file}`}
        width={width}
        height={height}
        alt={alt}
        // 説明用の画像はそのまま配信する(縮小・変換すると細かい文字が読みにくくなるため)
        unoptimized
        className="h-auto w-full rounded border shadow-sm"
      />
      <figcaption className="mt-1 text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="border bg-gray-50 px-3 py-1.5 text-left text-xs font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 固定の表で並びは変わらない
            <tr key={i}>
              {r.map((c, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 固定の表で並びは変わらない
                <td key={j} className="border px-3 py-1.5 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Note = ({ children }: { children: ReactNode }) => (
  <p className="rounded border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-xs">{children}</p>
);

export default async function LegacyBondsManualPage() {
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        このページを表示する権限がありません。
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <Link href="/legacy-bonds" className="sf-back-link text-xs">
        ← 旧社債管理一覧へ
      </Link>

      <Card className="space-y-2 p-5">
        <h1 className="text-lg font-bold">旧社債管理 要件のまとめと使い方</h1>
        <p className="text-xs text-muted-foreground">
          2026-10-23
          作成。担当者の回答(「旧社債管理データの確認のお願い」2026-10-21)に基づく。画面の画像は架空のデータです。
        </p>
        <nav aria-label="目次" className="grid gap-1 pt-1 text-sm sm:grid-cols-2">
          {TOC.map((t) => (
            <a key={t.id} href={`#${t.id}`} className="text-primary hover:underline">
              {t.label}
            </a>
          ))}
        </nav>
      </Card>

      <Section id="about" title="1. この画面について">
        <p>
          旧社債の継続・償還を管理する画面です。Salesforce の「旧社債管理」を CRM に移したもので、
          <strong>1 行 = 1 つの申込の 1 回の満期(償還対象月)</strong>
          です。継続すると、同じ申込に次の満期の行が 1 行増えます。
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>見られるのは管理者(admin)だけです。メニューの「旧社債管理」から開きます。</li>
          <li>
            会員(K-)・申込(M-)に紐付いていて、一覧・詳細からそれぞれの詳細へ移れます。会員詳細の関連にも「旧社債管理」が出ます。
          </li>
          <li>
            利息・源泉税・償還金額は<strong>入力した元金・年数・利率から自動で計算</strong>
            します。手で金額を入れる欄はありません。
          </li>
        </ul>
      </Section>

      <Section id="rules" title="2. 要件のまとめ">
        <h3 className="font-semibold">金額の計算(1 円未満は切り捨て)</h3>
        <Table
          head={['項目', '計算式', '補足']}
          rows={[
            ['利息', '前回継続元金 × 前回継続利息(年)% × 前回継続年数', '単利(複利にしない)'],
            ['源泉税', '利息 × 20.315%', '「源泉徴収なし(海外法人名義)」の行は 0 円'],
            ['償還金額', '前回継続元金 + 利息 − 源泉税', '税引き後の受取額'],
            ['一部継続金額', '償還金額 − 一部償還金額', '「一部継続」のとき。次の期の元金になる'],
          ]}
        />
        <p className="text-xs text-muted-foreground">
          この式で、移行した 46 件すべての金額が Salesforce の値と一致することを確認しています。
        </p>

        <h3 className="pt-2 font-semibold">継続年数と利率(年)</h3>
        <Table
          head={['継続年数', ...LEGACY_BOND_YEAR_OPTIONS.map((y) => `${y} 年`)]}
          rows={[['利率(年)', ...LEGACY_BOND_YEAR_OPTIONS.map((y) => `${LEGACY_BOND_RATES[y]}%`)]]}
        />
        <p className="text-xs text-muted-foreground">
          古い行にある 8・9 年で 45〜68% のものは旧条件として、そのまま残しています。
        </p>

        <h3 className="pt-2 font-semibold">今回の結果</h3>
        <Table
          head={['値', '意味', '次の期']}
          rows={[
            ['(空)', '満期前。まだ何も決まっていない', '—'],
            ['回答待ち（未）', '満期が来たが、まだお客様に連絡していない', '—'],
            ['回答待ち', 'お客様に連絡済みで、返事を待っている', '—'],
            ['全額継続', '償還金額をすべて次の期の元金にする', '作る(元金 = 償還金額)'],
            ['一部継続', '一部を払い出し、残りを次の期の元金にする', '作る(元金 = 一部継続金額)'],
            ['全額償還', 'すべて払い出して終わり', '作らない'],
          ]}
        />

        <h3 className="pt-2 font-semibold">次の期のルール</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>償還対象月</strong> = 今回の償還対象月 + 継続年数 + 1
            か月(満期月の翌月から新しい期間が始まるため)。例: 2026/10 に 3 年継続 → 2029/11
          </li>
          <li>
            <strong>前回継続元金</strong> = 今回の償還金額(全額継続)/ 一部継続金額(一部継続)
          </li>
          <li>利率は上の表、金額は上の式で計算し、今回の結果は空で作ります。</li>
          <li>
            会員・申込・案件・社債名・入金額・銀行情報・源泉徴収なしは、今回の行から引き継ぎます。
          </li>
          <li>
            新しい行の ID は <strong>KS-001000000</strong> から順に付きます(Salesforce の
            KS-0000000xx と重ならないように離しています)。
          </li>
          <li>1 つの行から作れる次の期は 1 つだけです。</li>
        </ul>

        <h3 className="pt-2 font-semibold">一覧で目立たせる行</h3>
        <Table
          head={['色', '条件']}
          rows={[
            [
              <span key="r" className="rounded bg-red-100 px-1.5 text-red-800">
                赤(満期超過)
              </span>,
              '償還対象月が今月より前で、今回の結果が 空 / 回答待ち / 回答待ち（未）',
            ],
            [
              <span key="y" className="rounded bg-amber-100 px-1.5 text-amber-800">
                黄(満期間近)
              </span>,
              '償還対象月が今月〜2 か月後で、今回の結果が 空 / 回答待ち / 回答待ち（未）',
            ],
          ]}
        />
      </Section>

      <Section id="flow" title="3. 満期が来たときの流れ">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            一覧で<strong>黄色(満期間近)・赤(満期超過)</strong>の行を確認します。
          </li>
          <li>
            お客様に連絡する前は、詳細の「編集」で今回の結果を<strong>「回答待ち（未）」</strong>
            にします。
          </li>
          <li>
            連絡したら<strong>「回答待ち」</strong>にします。契約書を送ったら
            <strong>契約書送付日</strong>も入れます。
          </li>
          <li>
            お客様の返事が来たら、今回の結果を<strong>全額継続 / 一部継続 / 全額償還</strong>
            のどれかにします。一部継続なら一部償還金額(払い出す額)も入れます。
          </li>
          <li>
            継続(全額 / 一部)なら、詳細の下に出る<strong>「次の期を作成」</strong>
            で継続年数を選んで次の期の行を作ります。
          </li>
        </ol>
        <Note>
          今回の結果を空のままにしておくと、満期を過ぎても「満期前」と区別できません。満期が来たら必ず「回答待ち（未）」以降にしてください。
        </Note>
      </Section>

      <Section id="list" title="4. 一覧の見方">
        <Shot
          file="01-list.png"
          width={2560}
          height={1102}
          alt="旧社債管理の一覧画面"
          caption="一覧。回答が決まっていない行のうち、満期を過ぎたものは赤、2 か月以内のものは黄で表示される"
        />
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>検索</strong>:
            旧社債管理ID・会員ID・会員氏名・申込ID・社債名・今回の結果の一部で探せます。
          </li>
          <li>
            <strong>絞り込み</strong>: 社債名・今回の結果(「未入力」も選べる)・償還対象月の範囲。
          </li>
          <li>
            <strong>並び替え</strong>: 列の見出しをクリックするか、「並び替え」と昇順 /
            降順を選びます。既定は償還対象月の新しい順です。
          </li>
          <li>
            旧社債管理ID をクリックすると詳細、会員ID・会員氏名は会員詳細、申込ID
            は申込詳細が開きます。
          </li>
          <li>表示する列は 設定 → オブジェクト管理 → 旧社債管理 で変えられます。</li>
        </ul>
      </Section>

      <Section id="detail" title="5. 詳細の見方">
        <Shot
          file="02-detail.png"
          width={2560}
          height={1968}
          alt="旧社債管理の詳細画面"
          caption="詳細。右上の「編集」で内容を直す。今回の結果が継続のときは、下に「次の期を作成」が出る"
        />
        <ul className="list-disc space-y-1 pl-5">
          <li>上の帯に、社債名・入金額・償還対象月・償還金額・今回の結果をまとめて出します。</li>
          <li>
            右側の<strong>前の期 / 次の期</strong>は、継続でつながった行へのリンクです。
          </li>
        </ul>
      </Section>

      <Section id="edit" title="6. 編集する">
        <p>詳細の右上の「編集」を押すと、次の項目を直せます。</p>
        <Shot
          file="03-edit.png"
          width={1280}
          height={1080}
          alt="旧社債管理の編集ダイアログ"
          caption="編集ダイアログ。下の「自動計算」に、保存したときの利息・源泉税・償還金額が出る"
          narrow
        />
        <Table
          head={['項目', '説明']}
          rows={[
            ['今回の結果', '上の「今回の結果」の表から選ぶ。空(満期前)にもできる'],
            ['契約書送付日', '契約書を送った日'],
            ['前回継続元金(円)', 'この期の元金'],
            [
              '前回継続年数(年)',
              '1・2・3・5・8 年を入れると、利率も表の値に自動で変わる(それ以外の年数は利率を手で入れる)',
            ],
            ['前回継続利息(年 %)', '年利。普段は年数に合わせて自動で入る'],
            ['源泉徴収なし(海外法人名義)', 'チェックすると源泉税が 0 円になる。次の期にも引き継ぐ'],
            ['一部償還金額(円)', '今回の結果が「一部継続」のときだけ出る。払い出す額'],
            ['銀行情報', '振込先など'],
          ]}
        />
        <p>
          今回の結果を「一部継続」にすると、一部償還金額の欄と、次の期の元金になる一部継続金額が出ます。
        </p>
        <Shot
          file="04-edit-partial.png"
          width={1280}
          height={1244}
          alt="一部継続を選んだときの編集ダイアログ"
          caption="一部継続。償還金額 4,478,110 円のうち 1,000,000 円を払い出し、残りの 3,478,110 円が次の期の元金になる"
          narrow
        />
        <Note>
          一部償還金額は 0
          円より大きく、償還金額より小さい額にしてください。範囲外だと保存できません。
        </Note>
      </Section>

      <Section id="continue" title="7. 次の期を作成する">
        <p>
          今回の結果が<strong>全額継続 / 一部継続</strong>
          で、まだ次の期を作っていない行の詳細には、下に「次の期を作成」が出ます。
        </p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>継続年数を選びます(年数の横に利率が出ます)。</li>
          <li>
            下の枠に、作られる行の償還対象月・元金・利息・源泉税・償還金額が出るので確かめます。
          </li>
          <li>「次の期を作成」を押し、確認のメッセージで OK を押します。</li>
          <li>作った行の詳細が開きます。</li>
        </ol>
        <Shot
          file="05-continue.png"
          width={2496}
          height={464}
          alt="次の期を作成の欄"
          caption="2026/10 満期の行を 3 年継続する例。満期は 2029/11、元金は今回の償還金額"
        />
        <Shot
          file="08-next-period.png"
          width={2560}
          height={1480}
          alt="作成した次の期の詳細"
          caption="作成した次の期の行(KS-001000000)。「前の期」から元の行へ戻れる。源泉徴収なしも引き継がれている"
        />
        <Note>
          年数を間違えて作った場合、作った行の「編集」で前回継続年数(と利率)を直せば金額は計算し直されますが、償還対象月は編集できません。作り直しが必要なときはシステム担当に連絡してください。
        </Note>
      </Section>

      <Section id="after" title="8. 次の期を作った後">
        <p>
          次の期を作った行は、<strong>今回の結果・金額・源泉徴収なしを変更できません</strong>
          (次の期の元金と食い違わないようにするため)。契約書送付日と銀行情報は直せます。
        </p>
        <Shot
          file="06-linked.png"
          width={2560}
          height={1480}
          alt="次の期を作成済みの行の詳細"
          caption="次の期を作成済みの行。「次の期」に作った行へのリンクが出て、「次の期を作成」の欄は消える"
        />
        <Shot
          file="07-edit-locked.png"
          width={1280}
          height={1120}
          alt="次の期を作成済みの行の編集ダイアログ"
          caption="次の期を作成済みの行を編集するときは、金額などの欄が変更できなくなる"
          narrow
        />
      </Section>

      <Section id="other" title="9. 取込・削除">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>CSV 取込</strong>: 設定 → データ取込 で「旧社債管理」を選びます。Salesforce の
            CSV の列のまま取り込め、旧社債管理ID が同じ行は上書きします。
          </li>
          <li>
            <strong>削除</strong>:
            一覧の行の左のゴミ箱、または左端のチェックで複数選んで、上に出る削除ボタン。データは消えず非表示になります(1
            回 500 件まで)。
          </li>
        </ul>
        <Note>
          CSV で再取込すると、CRM で編集した金額や今回の結果も CSV の値で上書きされます。Salesforce
          の運用を止めた後は、再取込しないでください。
        </Note>
      </Section>

      <Section id="faq" title="10. よくある質問">
        <dl className="space-y-3">
          <div>
            <dt className="font-semibold">Q. 金額を直接入力したい</dt>
            <dd>
              A.
              金額は元金・年数・利率から計算する仕組みで、直接は入れられません。計算が合わない場合は元金・年数・利率を確かめてください。
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Q. 「次の期を作成」が出ない</dt>
            <dd>
              A.
              今回の結果が「全額継続」か「一部継続」のときだけ出ます。すでに次の期を作った行(「次の期」にリンクがある行)にも出ません。
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Q. 1 つの申込が複数の口に分かれている</dt>
            <dd>
              A. 口ごとに 1 行ずつ管理します(例:
              KS-000000032〜035)。それぞれの行で継続・償還を決めてください。
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Q. 海外法人名義のお客様が増えた</dt>
            <dd>
              A.
              その行の「編集」で「源泉徴収なし(海外法人名義)」にチェックしてください。次の期にも引き継がれます。
            </dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}
