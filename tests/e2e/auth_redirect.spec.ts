import { expect, test } from '@playwright/test';

/**
 * E2E スモーク: 認証フロー
 * 仕様書 §10 Phase 7「E2Eテスト最低限」
 *
 * 前提:
 *   - dev サーバーが立ち上がっている
 *   - middleware.ts で未ログイン時 /login にリダイレクトされる
 */

test.describe('認証リダイレクト', () => {
  test('未ログイン時、トップアクセスでログイン画面にリダイレクト', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'ひらプロCRM' })).toBeVisible();
  });

  test('未ログイン時、会員一覧にアクセスしてもログイン画面にリダイレクト', async ({ page }) => {
    await page.goto('/members');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('ログインフォームに必須項目バリデーション', async ({ page }) => {
    await page.goto('/login');
    const email = page.getByLabel('メールアドレス');
    const password = page.getByLabel('パスワード');
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    // 必須属性が付いていること
    await expect(email).toHaveAttribute('required', '');
    await expect(password).toHaveAttribute('required', '');
  });

  test('間違ったログイン情報でエラー表示', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('メールアドレス').fill('nope@example.com');
    await page.getByLabel('パスワード').fill('wrongpassword');
    await page.getByRole('button', { name: /ログイン/ }).click();
    // Supabase Auth が返すエラーメッセージ(日本語に変換済み)
    await expect(
      page.getByText('メールアドレスまたはパスワードが正しくありません'),
    ).toBeVisible({ timeout: 10_000 });
  });
});
