BEGIN;

-- 既存環境で001_initial.sqlを適用済みの場合も、追加テーマを受け入れられるようにする。
DO $$
DECLARE
  table_name TEXT;
  constraint_name TEXT;
  category_tables TEXT[] := ARRAY[
    'cms_providers',
    'cms_role_assignments',
    'cms_sessions',
    'cms_requests',
    'cms_jobs',
    'cms_applications',
    'cms_content_proposals',
    'cms_contents'
  ];
  category_values TEXT := '''legal'', ''beauty'', ''ai-business'', ''labor-shortage'', ''tourism'', ''mobility-dx'', ''gx'', ''regional-revitalization''';
  assignment_values TEXT := category_values || ', ''*''';
BEGIN
  FOREACH table_name IN ARRAY category_tables LOOP
    IF to_regclass(table_name) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
      table_name,
      table_name || '_category_check'
    );

    SELECT conname
      INTO constraint_name
      FROM pg_constraint
     WHERE conrelid = to_regclass(table_name)
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%category%';

    IF constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', table_name, constraint_name);
    END IF;

    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (category IN (%s))',
      table_name,
      table_name || '_category_check',
      CASE WHEN table_name = 'cms_role_assignments' THEN assignment_values ELSE category_values END
    );
  END LOOP;
END $$;

COMMIT;
