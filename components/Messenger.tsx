"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";

export type Person = { id: string; name: string; email: string | null; role: string };
export type Channel = { id: string; kind: "team" | "dm" | "group"; name: string | null; creator: string | null; unread: number; members: string[] };
type Msg = { id: string; channel_id: string; sender_id: string; body: string; gif_url: string | null; created_at: string; chat_reactions: { user_id: string; emoji: string }[] };
type Gif = { id: string; title: string; url: string; preview?: string };

const QUICK = ["👍", "❤️", "😂", "🎉", "👀", "✅"];
const MORE = ["🔥", "🙏", "😮", "😢", "💐", "🌹", "🚚", "❗", "👏", "💯", "🤔", "😎"];

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

export function Messenger({ me, channels: initialChannels, people, initial, gifsConfigured }: { me: string; channels: Channel[]; people: Person[]; initial: string | null; gifsConfigured: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [channels, setChannels] = useState(initialChannels);
  const [active, setActive] = useState<string | null>(initial);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<string | null>(null); // message id with the emoji palette open
  const [gifOpen, setGifOpen] = useState(false);
  const [newChat, setNewChat] = useState(false);
  const [mobileThread, setMobileThread] = useState(false); // phones open on the chat list
  const bottom = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const nameOf = useCallback((id: string) => people.find((p) => p.id === id)?.name ?? "Someone", [people]);
  const label = useCallback(
    (c: Channel) => (c.kind === "dm" ? nameOf(c.members.find((m) => m !== me) ?? "") : c.name ?? "Chat"),
    [me, nameOf],
  );
  const current = channels.find((c) => c.id === active) ?? null;

  const refreshList = useCallback(async () => {
    const [{ data: chs }, { data: unread }, { data: mem }] = await Promise.all([
      supabase.from("chat_channels").select("id, kind, name, created_by").order("created_at"),
      supabase.rpc("chat_unread"),
      supabase.from("chat_members").select("channel_id, user_id"),
    ]);
    if (!chs) return;
    const u = new Map<string, number>((unread ?? []).map((r: any) => [r.channel_id as string, Number(r.unread)]));
    setChannels(
      chs.map((c: any) => ({
        id: c.id,
        kind: c.kind,
        name: c.name,
        creator: c.created_by,
        unread: c.id === activeRef.current ? 0 : u.get(c.id) ?? 0,
        members: (mem ?? []).filter((m: any) => m.channel_id === c.id).map((m: any) => m.user_id),
      })),
    );
  }, [supabase]);

  const load = useCallback(
    async (id: string) => {
      const { data } = await supabase
        .from("chat_messages")
        .select("id, channel_id, sender_id, body, gif_url, created_at, chat_reactions(user_id, emoji)")
        .eq("channel_id", id)
        .order("created_at", { ascending: false })
        .limit(150);
      if (id !== activeRef.current) return;
      setMsgs(((data ?? []) as unknown as Msg[]).reverse());
    },
    [supabase],
  );

  const markRead = useCallback(
    async (id: string) => {
      await supabase.rpc("chat_mark_read", { p_channel: id });
      setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
    },
    [supabase],
  );

  // Open a channel
  useEffect(() => {
    if (!active) return;
    setMsgs([]);
    load(active).then(() => markRead(active));
  }, [active, load, markRead]);

  // Live updates: realtime where the server offers it, plus a short poll as a safety net
  useEffect(() => {
    const ch = supabase
      .channel("messenger")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, () => {
        if (activeRef.current) load(activeRef.current).then(() => { if (activeRef.current) markRead(activeRef.current); });
        refreshList();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_reactions" }, () => { if (activeRef.current) load(activeRef.current); })
      .subscribe();
    const t = setInterval(() => {
      if (document.hidden) return;
      if (activeRef.current) load(activeRef.current);
      refreshList();
    }, 5000);
    return () => {
      clearInterval(t);
      supabase.removeChannel(ch);
    };
  }, [supabase, load, markRead, refreshList]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [msgs.length, active]);

  async function send(body: string, gif?: string) {
    if (!active) return;
    setError(null);
    const { error: e } = await supabase.from("chat_messages").insert({ channel_id: active, body: body.trim(), gif_url: gif ?? null });
    if (e) return setError(e.message.includes("row-level") ? "You can't post here." : e.message);
    setText("");
    setGifOpen(false);
    await load(active);
    await markRead(active);
  }

  async function react(id: string, emoji: string) {
    setPicker(null);
    // optimistic
    setMsgs((ms) =>
      ms.map((m) => {
        if (m.id !== id) return m;
        const has = m.chat_reactions.some((r) => r.user_id === me && r.emoji === emoji);
        return { ...m, chat_reactions: has ? m.chat_reactions.filter((r) => !(r.user_id === me && r.emoji === emoji)) : [...m.chat_reactions, { user_id: me, emoji }] };
      }),
    );
    const { error: e } = await supabase.rpc("chat_react", { p_message: id, p_emoji: emoji });
    if (e) {
      setError(e.message);
      if (active) load(active);
    }
  }

  async function startDm(person: string) {
    const { data, error: e } = await supabase.rpc("chat_open_dm", { p_user: person });
    if (e) return setError(e.message);
    setNewChat(false);
    await refreshList();
    setActive(data as string);
    setMobileThread(true);
    router.replace(`/messages?channel=${data}`);
  }

  async function startGroup(name: string, users: string[]) {
    const { data, error: e } = await supabase.rpc("chat_create_group", { p_name: name, p_users: users });
    if (e) return setError(e.message);
    setNewChat(false);
    await refreshList();
    setActive(data as string);
    setMobileThread(true);
  }

  async function leave() {
    if (!active || !confirm("Leave this group?")) return;
    await supabase.rpc("chat_leave", { p_channel: active });
    setActive(null);
    setMobileThread(false);
    refreshList();
  }

  const groups = (kind: Channel["kind"]) => channels.filter((c) => c.kind === kind);
  const totalUnread = channels.reduce((n, c) => n + c.unread, 0);

  const row = (c: Channel, prefix: string) => (
    <li key={c.id}>
      <button
        type="button"
        onClick={() => {
          setActive(c.id);
          setMobileThread(true);
          setError(null);
          router.replace(`/messages?channel=${c.id}`);
        }}
        aria-current={c.id === active ? "true" : undefined}
        className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm ${c.id === active ? "bg-brand-50 font-semibold text-brand-800" : "hover:bg-stone-100"}`}
        data-channel={label(c)}
      >
        <span className="truncate">
          <span className="text-stone-400">{prefix}</span> {label(c)}
        </span>
        {c.unread > 0 && (
          <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white" aria-label={`${c.unread} unread`}>
            {c.unread}
          </span>
        )}
      </button>
    </li>
  );

  let lastDay = "";
  return (
    <div className="grid h-[calc(100dvh-7rem)] min-h-[28rem] grid-cols-1 gap-4 md:grid-cols-[17rem_1fr]" data-testid="messenger" data-unread={totalUnread}>
      <aside className={`${mobileThread ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-col rounded-2xl border border-stone-200 bg-white p-3`} aria-label="Chats">
        <div className="mb-2 flex items-center justify-between px-1">
          <h1 className="text-lg font-semibold">Messages</h1>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setNewChat(true)}>
            New chat
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <section>
            <h2 className="px-3 pb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">Teams</h2>
            <ul>{groups("team").map((c) => row(c, "#"))}</ul>
          </section>
          <section>
            <h2 className="px-3 pb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">Direct</h2>
            <ul>{groups("dm").map((c) => row(c, "@"))}</ul>
            {!groups("dm").length && <p className="px-3 text-xs text-stone-500">Start a chat with New chat.</p>}
          </section>
          <section>
            <h2 className="px-3 pb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">Groups</h2>
            <ul>{groups("group").map((c) => row(c, "👥"))}</ul>
          </section>
        </div>
      </aside>

      <section className={`${mobileThread ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-col rounded-2xl border border-stone-200 bg-white`} aria-label="Conversation">
        {!current ? (
          <div className="m-auto text-sm text-stone-500">Pick a chat to start.</div>
        ) : (
          <>
            <header className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <button type="button" className="btn btn-sm md:hidden" onClick={() => setMobileThread(false)} aria-label="Back to chats">
                  ←
                </button>
                <h2 className="truncate font-semibold">
                  {current.kind === "team" ? "# " : current.kind === "dm" ? "@ " : ""}
                  {label(current)}
                </h2>
                {current.kind === "group" && <span className="truncate text-xs text-stone-500">{current.members.map(nameOf).join(", ")}</span>}
              </div>
              {current.kind === "group" && (
                <button type="button" className="btn btn-sm" onClick={leave}>
                  Leave
                </button>
              )}
            </header>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3" aria-live="polite">
              {!msgs.length && <p className="py-8 text-center text-sm text-stone-500">No messages yet. Say hello.</p>}
              {msgs.map((m, i) => {
                const d = new Date(m.created_at);
                const day = dayFmt.format(d);
                const showDay = day !== lastDay;
                lastDay = day;
                const mine = m.sender_id === me;
                const prev = msgs[i - 1];
                const showName = !prev || prev.sender_id !== m.sender_id || showDay;
                const counts = new Map<string, { n: number; mine: boolean; who: string[] }>();
                for (const r of m.chat_reactions) {
                  const c = counts.get(r.emoji) ?? { n: 0, mine: false, who: [] };
                  c.n++;
                  c.who.push(nameOf(r.user_id));
                  if (r.user_id === me) c.mine = true;
                  counts.set(r.emoji, c);
                }
                return (
                  <div key={m.id}>
                    {showDay && <div className="my-3 text-center text-xs text-stone-500">{day}</div>}
                    <div className={`group relative flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                        {showName && (
                          <div className="mb-0.5 px-1 text-xs text-stone-500">
                            <b className="text-stone-700">{mine ? "You" : nameOf(m.sender_id)}</b> · {timeFmt.format(d)}
                          </div>
                        )}
                        <div className={`rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap ${mine ? "bg-brand-600 text-white" : "bg-stone-100"}`} data-msg={m.body || "gif"}>
                          {m.body}
                          {m.gif_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.gif_url} alt="GIF" loading="lazy" className="mt-1 max-h-52 rounded-xl" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.replaceWith(Object.assign(document.createElement("a"), { href: m.gif_url!, target: "_blank", rel: "noopener noreferrer", textContent: "GIF (couldn't load, open link)", className: "underline" })); }} />
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {[...counts].map(([emoji, c]) => (
                            <button
                              key={emoji}
                              type="button"
                              title={c.who.join(", ")}
                              onClick={() => react(m.id, emoji)}
                              aria-pressed={c.mine}
                              className={`rounded-full border px-2 py-0.5 text-xs ${c.mine ? "border-brand-400 bg-brand-50" : "border-stone-200 bg-white"}`}
                            >
                              {emoji} {c.n}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setPicker(picker === m.id ? null : m.id)}
                            className="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-500 opacity-60 hover:opacity-100 focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                            aria-label="Add reaction"
                            aria-expanded={picker === m.id}
                          >
                            ☺ +
                          </button>
                        </div>
                        {picker === m.id && (
                          <div className="z-10 mt-1 flex max-w-xs flex-wrap gap-1 rounded-xl border border-stone-200 bg-white p-2 shadow-md" role="group" aria-label="Reactions">
                            {[...QUICK, ...MORE].map((e) => (
                              <button key={e} type="button" className="rounded-lg px-1.5 py-1 text-lg hover:bg-stone-100" onClick={() => react(m.id, e)} aria-label={`React ${e}`}>
                                {e}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottom} />
            </div>

            {error && (
              <div role="alert" className="mx-4 mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </div>
            )}
            {gifOpen && <GifPicker configured={gifsConfigured} onPick={(url) => send("", url)} onClose={() => setGifOpen(false)} />}
            <form
              className="flex items-end gap-2 border-t border-stone-200 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) send(text);
              }}
            >
              <button type="button" className="btn" onClick={() => setGifOpen((v) => !v)} aria-expanded={gifOpen} aria-label="Add a GIF">
                GIF
              </button>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (text.trim()) send(text);
                  }
                }}
                rows={1}
                maxLength={4000}
                placeholder={`Message ${current.kind === "team" ? "#" : ""}${label(current)}`}
                className="input max-h-32 min-h-[2.5rem] flex-1 resize-none"
                aria-label="Message"
              />
              <button className="btn btn-primary" disabled={!text.trim()}>
                Send
              </button>
            </form>
          </>
        )}
      </section>

      {newChat && <NewChat me={me} people={people} onClose={() => setNewChat(false)} onDm={startDm} onGroup={startGroup} error={error} />}
    </div>
  );
}

function GifPicker({ configured, onPick, onClose }: { configured: boolean; onPick: (url: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!configured) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/giphy?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        const j = await r.json();
        setGifs(j.gifs ?? []);
        setNote(j.error ?? null);
      } catch {
        if (!ctl.signal.aborted) setNote("Couldn't load GIFs.");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, configured]);

  const okLink = /^https:\/\/\S{4,}$/.test(link.trim());
  return (
    <div className="pop-in mx-3 mb-2 rounded-2xl border border-stone-200 bg-white p-3 shadow-md" role="dialog" aria-label="Choose a GIF">
      <div className="mb-2 flex items-center justify-between gap-2">
        {configured ? (
          <input className="input flex-1" placeholder="Search GIPHY" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search GIFs" />
        ) : (
          <p className="text-xs text-stone-500">GIF search turns on when an admin adds a GIPHY key. For now, paste a link to a GIF.</p>
        )}
        <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close GIF picker">
          ✕
        </button>
      </div>
      {configured ? (
        <>
          {note && <p className="mb-1 text-xs text-red-700">{note}</p>}
          <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4" aria-busy={loading}>
            {gifs.map((g) => (
              <button key={g.id} type="button" onClick={() => onPick(g.url)} className="overflow-hidden rounded-lg bg-stone-100" title={g.title}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.preview ?? g.url} alt={g.title || "GIF"} loading="lazy" className="h-20 w-full object-cover" />
              </button>
            ))}
            {!gifs.length && !loading && <p className="col-span-full text-xs text-stone-500">No GIFs found.</p>}
          </div>
          <p className="mt-2 text-right text-[10px] text-stone-400">Powered by GIPHY</p>
        </>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (okLink) onPick(link.trim());
          }}
        >
          <input className="input flex-1" placeholder="https://media.giphy.com/…/giphy.gif" value={link} onChange={(e) => setLink(e.target.value)} aria-label="GIF link" />
          <button className="btn btn-primary" disabled={!okLink}>
            Send GIF
          </button>
        </form>
      )}
    </div>
  );
}

function NewChat({ me, people, onClose, onDm, onGroup, error }: { me: string; people: Person[]; onClose: () => void; onDm: (id: string) => void; onGroup: (name: string, users: string[]) => void; error: string | null }) {
  const [mode, setMode] = useState<"dm" | "group">("dm");
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const others = people.filter((p) => p.id !== me && (p.name + (p.email ?? "")).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="modal-bg fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="New chat">
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex gap-1" role="tablist">
            {(["dm", "group"] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`btn btn-sm ${mode === m ? "btn-primary" : ""}`}>
                {m === "dm" ? "One person" : "Group"}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {mode === "group" && <input className="input mb-2" placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Group name" />}
        <input className="input mb-2" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        <ul className="max-h-64 divide-y divide-stone-100 overflow-y-auto">
          {others.map((p) => (
            <li key={p.id}>
              {mode === "dm" ? (
                <button type="button" className="flex w-full items-center justify-between px-2 py-2 text-left text-sm hover:bg-stone-50" onClick={() => onDm(p.id)}>
                  <span>{p.name}</span>
                  <span className="text-xs text-stone-500 capitalize">{p.role.replace("_", " ")}</span>
                </button>
              ) : (
                <label className="flex cursor-pointer items-center gap-3 px-2 py-2 text-sm hover:bg-stone-50">
                  <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />
                  <span className="flex-1">{p.name}</span>
                  <span className="text-xs text-stone-500 capitalize">{p.role.replace("_", " ")}</span>
                </label>
              )}
            </li>
          ))}
          {!others.length && <li className="px-2 py-3 text-sm text-stone-500">No one else to message yet. Add users in Users &amp; roles.</li>}
        </ul>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        {mode === "group" && (
          <button type="button" className="btn btn-primary mt-3 w-full" disabled={!name.trim() || picked.length < 2} onClick={() => onGroup(name, picked)}>
            Create group{picked.length ? ` (${picked.length + 1} people)` : ""}
          </button>
        )}
      </div>
    </div>
  );
}
