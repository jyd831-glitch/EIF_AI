import { NextResponse } from "next/server";
import { assertLocalFs, resolveDefaultRoot } from "@/lib/server/localFs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    assertLocalFs();
    const path = resolveDefaultRoot();
    return NextResponse.json({ path });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
