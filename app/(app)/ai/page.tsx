import { Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function AiPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-sm text-center shadow-md">
        <CardContent className="space-y-4 py-10">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-xl font-bold">AI アシスタント</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            顧客情報・対応歴・申込データを参照して、
            <br />
            必要な情報を自然言語で引き出せる機能を準備中です。
          </p>
          <span className="inline-block rounded-full bg-muted px-4 py-1.5 text-xs font-semibold tracking-wider text-muted-foreground">
            Coming Soon
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
