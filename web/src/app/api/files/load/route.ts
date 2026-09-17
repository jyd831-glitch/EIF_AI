import { NextRequest, NextResponse } from "next/server";
import { loadLogFolder } from "@/lib/server/localFs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { folder?: string };
    if (!body.folder?.trim()) {
      return NextResponse.json({ error: "folder 경로가 필요합니다." }, { status: 400 });
    }
    const result = loadLogFolder(body.folder.trim());
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = /Vercel|클라우드|로컬 디스크/.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
