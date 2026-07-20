create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Run after storing project_url and notification_dispatch_key in Supabase Vault.
select cron.schedule(
  'family-notification-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notification-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-key', (select decrypted_secret from vault.decrypted_secrets where name = 'notification_dispatch_key')
    ),
    body := jsonb_build_object('requested_at', now())
  );
  $$
);
