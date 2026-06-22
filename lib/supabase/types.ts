/**
 * このファイルは Supabase CLI によって自動生成されます。
 *   $ pnpm db:types
 *
 * Phase 0 時点ではスキーマがまだ Supabase に適用されていないため、
 * 暫定的に空のジェネリック型のみを定義しておく。
 *
 * 仕様書 §2: `supabase gen types typescript` で自動生成
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// biome-ignore lint/complexity/noBannedTypes: 自動生成までのプレースホルダ
export interface Database {
  public: {
    Tables: {};
    Views: {};
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
}
