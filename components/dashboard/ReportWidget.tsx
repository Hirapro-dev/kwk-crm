import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DashboardWidget } from '@/lib/domain/dashboard_widgets';
import { formatDateTime } from '@/lib/utils/date';

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return formatDateTime(v);
    return v;
  }
  if (typeof v === 'number') return Number(v).toLocaleString();
  if (typeof v === 'boolean') return v ? '✓' : '';
  return JSON.stringify(v);
}

export function ReportWidget({ widget }: { widget: DashboardWidget }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">
          <Link href={`/reports/${widget.reportId}`} className="hover:underline">
            ★ {widget.name}
          </Link>
        </CardTitle>
        <Badge variant="outline">{widget.reportType}</Badge>
      </CardHeader>
      <CardContent className="p-0">
        {widget.error ? (
          <p className="p-4 text-xs text-destructive">{widget.error}</p>
        ) : widget.columns.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">該当データなし</p>
        ) : (
          <div className="max-h-64 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {widget.columns.slice(0, 4).map((c) => (
                    <TableHead key={c.alias} className="whitespace-nowrap text-xs">
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {widget.rows.slice(0, 5).map((row, i) => (
                  <TableRow key={i}>
                    {widget.columns.slice(0, 4).map((c) => (
                      <TableCell key={c.alias} className="whitespace-nowrap text-xs">
                        {formatCell(row[c.alias])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="border-t p-2 text-right">
          <Link
            href={`/reports/${widget.reportId}`}
            className="text-xs text-primary hover:underline"
          >
            すべて見る →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
