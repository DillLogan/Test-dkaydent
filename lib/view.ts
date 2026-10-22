import { cookies } from "next/headers";

export type ListView = "cards" | "table";
export const viewCookie = (list: string) => `dk-view-${list}`;

/** Card or table view for a list, remembered per browser (photo cards by default). */
export async function listView(list: string): Promise<ListView> {
  const v = (await cookies()).get(viewCookie(list))?.value;
  return v === "table" ? "table" : "cards";
}
