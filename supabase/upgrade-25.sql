-- ============================================================
--  upgrade-25.sql — server-scheduled reminder broadcasts (FCM)
--
--  Hydration / stretch-break / wind-down reminders are sent as FCM broadcasts
--  (send_push_broadcast → every registered device) via pg_cron, at fixed INDIA
--  times (IST = UTC + 5:30, so UTC = IST − 5:30). This makes them arrive
--  reliably even when the app is closed — on-device AlarmManager alarms get
--  killed by aggressive battery managers (Motorola etc.).
--
--  Study reminders stay on-device (they're per-user, from each timetable, so
--  they can't be broadcast).
--
--  Idempotent: cron.schedule() upserts a job by name, so re-running is safe.
--  To change times, edit and re-run. To stop one: select cron.unschedule('name').
-- ============================================================

create extension if not exists pg_cron;

-- Hydration — IST 9/11/13/15/17/19/21
select cron.schedule('fl-hydration-09', '30 3 * * *',  $$select public.send_push_broadcast('💧 Hydration check','Drink a glass of water — your brain will thank you.','rem-water-09')$$);
select cron.schedule('fl-hydration-11', '30 5 * * *',  $$select public.send_push_broadcast('💧 Hydration check','Drink a glass of water — your brain will thank you.','rem-water-11')$$);
select cron.schedule('fl-hydration-13', '30 7 * * *',  $$select public.send_push_broadcast('💧 Hydration check','Drink a glass of water — your brain will thank you.','rem-water-13')$$);
select cron.schedule('fl-hydration-15', '30 9 * * *',  $$select public.send_push_broadcast('💧 Hydration check','Drink a glass of water — your brain will thank you.','rem-water-15')$$);
select cron.schedule('fl-hydration-17', '30 11 * * *', $$select public.send_push_broadcast('💧 Hydration check','Drink a glass of water — your brain will thank you.','rem-water-17')$$);
select cron.schedule('fl-hydration-19', '30 13 * * *', $$select public.send_push_broadcast('💧 Hydration check','Drink a glass of water — your brain will thank you.','rem-water-19')$$);
select cron.schedule('fl-hydration-21', '30 15 * * *', $$select public.send_push_broadcast('💧 Hydration check','Drink a glass of water — your brain will thank you.','rem-water-21')$$);

-- Stretch breaks — IST 10/12/14/16/18/20
select cron.schedule('fl-break-10', '30 4 * * *',  $$select public.send_push_broadcast('🧘 Stretch break','Stand up, stretch, and rest your eyes for a minute.','rem-break-10')$$);
select cron.schedule('fl-break-12', '30 6 * * *',  $$select public.send_push_broadcast('🧘 Stretch break','Stand up, stretch, and rest your eyes for a minute.','rem-break-12')$$);
select cron.schedule('fl-break-14', '30 8 * * *',  $$select public.send_push_broadcast('🧘 Stretch break','Stand up, stretch, and rest your eyes for a minute.','rem-break-14')$$);
select cron.schedule('fl-break-16', '30 10 * * *', $$select public.send_push_broadcast('🧘 Stretch break','Stand up, stretch, and rest your eyes for a minute.','rem-break-16')$$);
select cron.schedule('fl-break-18', '30 12 * * *', $$select public.send_push_broadcast('🧘 Stretch break','Stand up, stretch, and rest your eyes for a minute.','rem-break-18')$$);
select cron.schedule('fl-break-20', '30 14 * * *', $$select public.send_push_broadcast('🧘 Stretch break','Stand up, stretch, and rest your eyes for a minute.','rem-break-20')$$);

-- Wind down — IST 22:00
select cron.schedule('fl-winddown-22', '30 16 * * *', $$select public.send_push_broadcast('🌙 Wind down','Time to wrap up and get good sleep — tomorrow needs you sharp. 🦁','rem-sleep')$$);
