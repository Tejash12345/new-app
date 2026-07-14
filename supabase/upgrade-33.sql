-- FocusLion upgrade 33: ring incoming CALLS via push (works when app is closed)
-- Safe to run multiple times. Requires upgrade-24 (push infra) already applied.
--
-- The web caller invokes this RPC when starting a voice/video call. It pushes a
-- high-priority "📞 <name> is calling…" notification to the callee's devices via
-- the existing fcm-send path, so the phone rings even if the app is closed or
-- killed. Tapping it deep-links to the chat, where the caller's re-sent offer
-- connects the call.

create or replace function public.ring_call(p_callee uuid, p_video boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_name   text;
begin
  if v_caller is null or p_callee is null or v_caller = p_callee then return; end if;

  -- only accepted friends may ring each other (prevents push spam)
  if not exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ( (f.requester_id = v_caller and f.addressee_id = p_callee)
         or (f.requester_id = p_callee and f.addressee_id = v_caller) )
  ) then
    return;
  end if;

  select coalesce(nullif(full_name, ''), 'Someone') into v_name
    from public.profiles where id = v_caller;

  perform public.send_push(
    p_callee,
    '📞 ' || coalesce(v_name, 'Someone') || ' is calling…',
    case when p_video then 'Incoming FocusLion video call — tap to answer'
                       else 'Incoming FocusLion voice call — tap to answer' end,
    'call-' || v_caller::text,   -- tag: a re-ring replaces the same notification
    jsonb_build_object(
      'type', 'call',
      'sender', v_caller,        -- NOT "from" (reserved key in FCM v1)
      'video', p_video,
      'caller_name', coalesce(v_name, 'Someone'),
      'channel_id', 'focuslion_calls'  -- loud, max-importance calls channel
    )
  );
end;
$$;

grant execute on function public.ring_call(uuid, boolean) to authenticated;
