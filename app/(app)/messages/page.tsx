import { getSession } from "@/lib/auth";
import { Messenger, type Channel, type Person } from "@/components/Messenger";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { channel } = await searchParams;
  const { supabase, profile } = await getSession();
  const [{ data: channels }, { data: people }, { data: unread }, { data: members }] = await Promise.all([
    supabase.from("chat_channels").select("id, kind, name, team_role, dm_key, created_by").order("created_at"),
    supabase.from("v_chat_people").select("id, name, email, role").order("name"),
    supabase.rpc("chat_unread"),
    supabase.from("chat_members").select("channel_id, user_id"),
  ]);
  const unreadBy = new Map<string, number>((unread ?? []).map((u: any) => [u.channel_id as string, Number(u.unread)]));
  const list: Channel[] = (channels ?? []).map((c: any) => ({
    id: c.id,
    kind: c.kind,
    name: c.name,
    creator: c.created_by,
    unread: unreadBy.get(c.id) ?? 0,
    members: (members ?? []).filter((m: any) => m.channel_id === c.id).map((m: any) => m.user_id),
  }));
  return (
    <Messenger
      me={profile.id}
      channels={list}
      people={(people ?? []) as Person[]}
      initial={list.find((c) => c.id === channel)?.id ?? list.find((c) => c.name === "Everyone")?.id ?? list[0]?.id ?? null}
      gifsConfigured={Boolean(process.env.GIPHY_API_KEY)}
    />
  );
}
