create table if not exists public.office_rankings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  week_start date not null,
  ranking_type text not null check (ranking_type in ('personal', 'team')),
  game_mode text not null check (game_mode in ('timedSurvival', 'endless', 'killTarget', 'supplyDefense')),
  display_name text not null,
  player_session_id text,
  score integer not null check (score >= 0),
  kills integer not null check (kills >= 0),
  survival_sec integer not null check (survival_sec >= 0),
  room_id text not null,
  room_title text not null,
  player_count integer not null check (player_count >= 0),
  difficulty text not null check (difficulty in ('easy', 'normal', 'hard')),
  game_duration_sec integer not null check (game_duration_sec >= 0),
  pvp_enabled boolean not null default false
);

create index if not exists office_rankings_week_type_mode_score_idx
  on public.office_rankings (week_start, ranking_type, game_mode, score desc, kills desc, survival_sec desc);

create index if not exists office_rankings_room_idx
  on public.office_rankings (room_id, recorded_at desc);
