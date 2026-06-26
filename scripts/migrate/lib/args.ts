/**
 * 移行スクリプト共通: CLI 引数パース
 * 仕様書 §6.2: --dry-run フラグ必須
 */

export interface MigrateArgs {
  dryRun: boolean;
  file?: string;
  limit?: number;
  /** true の場合、既存ID(主キー衝突)は更新せずスキップ(ON CONFLICT DO NOTHING) */
  skipExisting: boolean;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): MigrateArgs {
  const args: MigrateArgs = {
    dryRun: false,
    skipExisting: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--skip-existing') {
      args.skipExisting = true;
    } else if (a === '--file' && argv[i + 1]) {
      args.file = argv[i + 1];
      i++;
    } else if (a === '--limit' && argv[i + 1]) {
      const n = Number.parseInt(argv[i + 1]!, 10);
      if (!Number.isNaN(n)) args.limit = n;
      i++;
    }
  }

  return args;
}
