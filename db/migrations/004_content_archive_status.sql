BEGIN;

-- 既存環境でコンテンツのアーカイブ状態を利用できるようにする。
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  IF to_regclass('cms_contents') IS NULL THEN
    RAISE EXCEPTION 'cms_contentsテーブルが見つかりません。001_initial.sqlを先に適用してください。';
  END IF;

  SELECT conname
    INTO constraint_name
    FROM pg_constraint
   WHERE conrelid = to_regclass('cms_contents')
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%status%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE cms_contents DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE cms_contents
    ADD CONSTRAINT cms_contents_status_check
    CHECK (status IN ('proposed', 'drafted', 'polished', 'seo_reviewed', 'approved', 'published', 'archived'));
END $$;

COMMIT;
