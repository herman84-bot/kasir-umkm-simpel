create table if not exists chat_rate_log (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null,
  requested_at timestamptz not null default now()
);

create index if not exists chat_rate_log_user_requested_idx
  on chat_rate_log (user_id, requested_at);

alter table chat_rate_log enable row level security;

create policy "chat_rate_log_insert_own"
  on chat_rate_log for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "chat_rate_log_select_own"
  on chat_rate_log for select
  to authenticated
  using (auth.uid() = user_id);
