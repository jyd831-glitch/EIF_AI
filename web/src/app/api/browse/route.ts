import { NextRequest, NextResponse } from "next/server";
import { browseFolder, type BrowseMode } from "@/lib/server/localFs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get("path");
    const modeParam = req.nextUrl.searchParams.get("mode");
    const mode: BrowseMode = modeParam === "logviewer" ? "logviewer" : "timefloor";
    const result = browseFolder(path, mode);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = /Vercel|클라우드|로컬 디스크/.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
