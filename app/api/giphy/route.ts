import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** GIF search for the messenger. Needs GIPHY_API_KEY; without it the messenger falls back to pasting a GIF link. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const key = process.env.GIPHY_API_KEY;
  if (!key) return NextResponse.json({ configured: false, gifs: [] });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  const url = new URL(`https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("limit", "24");
  url.searchParams.set("rating", "pg");
  if (q) url.searchParams.set("q", q);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return NextResponse.json({ configured: true, gifs: [], error: "GIPHY didn't answer. Try again." });
    const body = await res.json();
    const gifs = (body.data ?? [])
      .map((g: any) => ({
        id: String(g.id),
        title: String(g.title ?? "").slice(0, 100),
        url: g.images?.fixed_height?.url as string | undefined,
        preview: g.images?.fixed_height_small?.url as string | undefined,
      }))
      .filter((g: any) => g.url?.startsWith("https://"));
    return NextResponse.json({ configured: true, gifs });
  } catch {
    return NextResponse.json({ configured: true, gifs: [], error: "GIPHY didn't answer. Try again." });
  }
}
