import { expect, test } from '@playwright/test';

/**
 * E2E スモーク: ログイン済みナビゲーション
 * 仕様書 §10 Phase 7
 *
 * 注意:
 *   - 実行には事前にテスト用 admin ユーザーが必要(招待 + パスワード設定済み)
 *   - 環境変数 E2E_EMAIL / E2E_PASSWORD で設定
 *   - 未設定の場合はテスト全体をスキップ
 */

const email = process.env.E2E_EMAIL ?? '';
const password = process.env.E2E_PASSWORD ?? '';

test.skip(!email || !password, 'E2E_EMAIL / E2E_PASSWORD 未設定のためスキップ');

test.describe.serial('ログイン後ナビゲーション', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('メールアドレス').fill(email);
    await page.getByLabel('パスワード').fill(password);
    await page.getByRole('button', { name: /ログイン/ }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
  });

  test('ダッシュボードが見える', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
    await expect(page.getByText('今日の活動件数')).toBeVisible();
  });

  test('会員一覧へ移動できる', async ({ page }) => {
    await page.getByRole('link', { name: '会員' }).first().click();
    await expect(page).toHaveURL(/\/members/);
    await expect(page.getByRole('heading', { name: '会員' })).toBeVisible();
  });

  test('活動履歴ページに入力フォームが常設されている(§8.2)', async ({ page }) => {
    await page.getByRole('link', { name: '活動履歴' }).first().click();
    await expect(page).toHaveURL(/\/activities/);
    // 仕様書 §8.2「上部固定の入力フォーム」
    await expect(page.getByRole('form', { name: '活動入力フォーム' })).toBeVisible();
  });

  test('レポート画面に標準レポートが表示される', async ({ page }) => {
    await page.getByRole('link', { name: 'レポート' }).first().click();
    await expect(page).toHaveURL(/\/reports/);
    // §9.12 標準レポート10件のいずれかが表示
    await expect(
      page.getByText(/大口会員ランキング|担当者別 今月活動件数|案件別 申込件数/),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('ログアウトすると /login に戻る', async ({ page }) => {
    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
