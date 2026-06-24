-- アクセントカラーをブルー (#1589ee) からグリーン (#00C896) に変更
UPDATE public.object_definitions
SET icon_color = '#00C896'
WHERE icon_color = '#1589ee';
