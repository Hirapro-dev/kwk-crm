/**
 * 旧 ユーザー管理画面 (/admin/users)
 *
 * 2026-05 更新: 設定エリア整理に伴い、ユーザー管理は /settings/users に移動。
 * 旧 URL へのアクセスは恒久的に新 URL に転送する。
 *
 * UserRoleEditor.tsx はこのディレクトリに残置し、/settings/users から import で再利用している。
 */

import { redirect } from 'next/navigation';

export default function AdminUsersRedirect(): never {
  // permanentRedirect でも良いが、HTTP 307 で十分。
  // /settings 側で admin チェックを行うため、ロール検証は移行先に任せる。
  redirect('/settings/users');
}
