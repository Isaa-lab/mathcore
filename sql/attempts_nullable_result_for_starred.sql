-- Allow attempts rows to represent "starred but not answered yet".
-- Without this, saving only is_starred=true fails because result is NOT NULL.

alter table public.attempts
  alter column result drop not null;

alter table public.attempts
  drop constraint if exists attempts_result_check;

alter table public.attempts
  add constraint attempts_result_check
  check (result is null or result in ('correct', 'wrong'));
