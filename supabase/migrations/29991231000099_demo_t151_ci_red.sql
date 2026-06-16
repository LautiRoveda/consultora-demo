-- DEMO T-151 (temporal, se revierte): dispara squawk a propósito en CI.
-- Índice no concurrente sobre tabla existente + ALTER sin SET de timeouts.
create index demo_t151_ci_idx on public.clientes (nombre);
alter table public.clientes add column demo_t151_ci_label text not null;
