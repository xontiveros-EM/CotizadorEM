select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'company_settings','instagram_accounts','rates','quotes',
    'quote_items','quote_events','sheet_sync'
  )
order by table_name;

