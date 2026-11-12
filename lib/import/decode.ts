/**
 * CSV ファイルのバイト列を文字列にする。UTF-8 として読めなければ Shift_JIS として読む(BOM は TextDecoder が外す)。
 * Salesforce や配信ツールの書き出しは Shift_JIS のことがあるため(取込画面の readCsvFile と同じ判定)。
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}
