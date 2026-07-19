-- ══════════════════════════════════════════════════════════════════
-- database-fix.sql — إصلاح أخطاء قاعدة البيانات الحالية
-- نفّذ هذا الملف كاملاً في Supabase SQL Editor لمشروعك الحالي
-- آمن للتنفيذ أكثر من مرة (Idempotent)
-- ══════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────
-- 1) سبب خطأ "join query failed" بين properties و profiles:
--    عمود owner_id في properties كان يشير إلى auth.users مباشرة
--    وليس إلى profiles، لذلك PostgREST لا يستطيع بناء الـ join
--    التلقائي الذي يستخدمه app.js: profiles!properties_owner_id_fkey
--    الحل: توجيه المفتاح الأجنبي نحو profiles بدلاً من auth.users
-- ──────────────────────────────────────────────────────────────────

-- تأكد أولاً أن كل owner_id موجود فعلاً كصف في profiles
-- (نادراً ما يفشل هذا، لكن إن حدث، شغّل هذا الإدراج التعويضي أولاً):
insert into public.profiles (id, name)
select distinct p.owner_id, 'مستخدم'
from public.properties p
left join public.profiles pr on pr.id = p.owner_id
where pr.id is null
on conflict (id) do nothing;

-- الآن أعد توجيه المفتاح الأجنبي:
alter table public.properties drop constraint if exists properties_owner_id_fkey;
alter table public.properties
  add constraint properties_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete cascade;

-- ──────────────────────────────────────────────────────────────────
-- 2) الجدول المفقود: seller_ratings
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.seller_ratings (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references auth.users(id) on delete cascade,
  rater_id      uuid not null references auth.users(id) on delete cascade,
  stars         int not null check (stars between 1 and 5),
  created_at    timestamptz default now(),
  unique(seller_id, rater_id)
);

alter table public.seller_ratings enable row level security;

drop policy if exists "ratings_select_all" on public.seller_ratings;
create policy "ratings_select_all" on public.seller_ratings for select using (true);

drop policy if exists "ratings_insert_own" on public.seller_ratings;
create policy "ratings_insert_own" on public.seller_ratings for insert with check (auth.uid() = rater_id);

drop policy if exists "ratings_update_own" on public.seller_ratings;
create policy "ratings_update_own" on public.seller_ratings for update using (auth.uid() = rater_id);

-- ──────────────────────────────────────────────────────────────────
-- 3) تأكيد وجود باقي الجداول المساندة (في حال لم تُنفَّذ سابقاً)
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.favorites (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  property_id   uuid not null references public.properties(id) on delete cascade,
  created_at    timestamptz default now(),
  unique(user_id, property_id)
);
alter table public.favorites enable row level security;
drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own" on public.favorites for select using (auth.uid() = user_id);
drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own" on public.favorites for insert with check (auth.uid() = user_id);
drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own" on public.favorites for delete using (auth.uid() = user_id);

create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  actor_id      uuid references auth.users(id) on delete set null,
  actor_name    text,
  type          text,
  message       text,
  property_id   uuid references public.properties(id) on delete cascade,
  is_read       boolean default false,
  created_at    timestamptz default now()
);
alter table public.notifications enable row level security;
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications for select using (auth.uid() = user_id);
drop policy if exists "notifications_insert_all" on public.notifications;
create policy "notifications_insert_all" on public.notifications for insert with check (true);
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications for update using (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────
-- 4) Trigger تحديث favorites_count (إن لم يكن موجوداً)
-- ──────────────────────────────────────────────────────────────────
create or replace function public.update_favorites_count()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    update public.properties set favorites_count = favorites_count + 1 where id = new.property_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.properties set favorites_count = greatest(0, favorites_count - 1) where id = old.property_id;
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_favorites_insert on public.favorites;
create trigger trg_favorites_insert after insert on public.favorites for each row execute function public.update_favorites_count();

drop trigger if exists trg_favorites_delete on public.favorites;
create trigger trg_favorites_delete after delete on public.favorites for each row execute function public.update_favorites_count();

-- ──────────────────────────────────────────────────────────────────
-- 5) تأكيد وجود Storage buckets (سبب محتمل لأخطاء 404 عند رفع/عرض الصور)
-- ──────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('property-images', 'property-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "property_images_public_read" on storage.objects;
create policy "property_images_public_read" on storage.objects for select using (bucket_id = 'property-images');

drop policy if exists "property_images_auth_upload" on storage.objects;
create policy "property_images_auth_upload" on storage.objects for insert with check (bucket_id = 'property-images' and auth.role() = 'authenticated');

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects for select using (bucket_id = 'avatars');

drop policy if exists "avatars_auth_upload" on storage.objects;
create policy "avatars_auth_upload" on storage.objects for insert with check (bucket_id = 'avatars' and auth.role() = 'authenticated');

-- ──────────────────────────────────────────────────────────────────
-- 6) نظام توثيق الحساب (العلامة الزرقاء ✔️)
-- ──────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists is_verified boolean default false;
alter table public.profiles add column if not exists verification_requested_at timestamptz;

create table if not exists public.verification_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  status         text default 'pending' check (status in ('pending','approved','rejected')),
  reason         text,           -- سبب الطلب / معلومات إضافية من المستخدم
  admin_note     text,           -- ملاحظة المراجع عند الموافقة/الرفض
  created_at     timestamptz default now(),
  reviewed_at    timestamptz,
  unique(user_id, status)        -- يمنع تكرار طلب "pending" لنفس المستخدم
);

alter table public.verification_requests enable row level security;

drop policy if exists "verif_select_own" on public.verification_requests;
create policy "verif_select_own" on public.verification_requests for select using (auth.uid() = user_id);

drop policy if exists "verif_insert_own" on public.verification_requests;
create policy "verif_insert_own" on public.verification_requests for insert with check (auth.uid() = user_id);

-- ملاحظة: الموافقة/الرفض (تحديث status إلى approved/rejected وتفعيل is_verified)
-- تتم يدوياً من طرفك عبر Supabase Table Editor أو SQL مباشرة — لا صلاحية للمستخدم بذلك:
--   update public.verification_requests set status='approved', reviewed_at=now() where id='...';
--   update public.profiles set is_verified=true where id='...';

-- ──────────────────────────────────────────────────────────────────
-- 7) تحقق نهائي — شغّل هذا الاستعلام للتأكد أن كل شيء سليم
-- ──────────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='properties')      as has_properties,
  (select count(*) from information_schema.tables where table_schema='public' and table_name='profiles')        as has_profiles,
  (select count(*) from information_schema.tables where table_schema='public' and table_name='favorites')       as has_favorites,
  (select count(*) from information_schema.tables where table_schema='public' and table_name='seller_ratings')  as has_seller_ratings,
  (select count(*) from information_schema.tables where table_schema='public' and table_name='notifications')   as has_notifications,
  (select count(*) from information_schema.tables where table_schema='public' and table_name='verification_requests') as has_verification_requests,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_verified') as has_is_verified_column,
  (select count(*) from pg_constraint where conname='properties_owner_id_fkey') as has_correct_fk;
-- يجب أن تكون كل القيم 1 (والأخيرة أيضاً 1) — إن ظهرت 0 لأي عمود، أرسل لي النتيجة
