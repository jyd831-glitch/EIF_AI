import { NextResponse } from "next/server";
import { isLocalFsEnabled, resolveDefaultRoot } from "@/lib/server/localFs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const local = isLocalFsEnabled();
  return NextResponse.json({
    mode: local ? "local" : "cloud",
    localFs: local,
    defaultRoot: local ? resolveDefaultRoot() : null,
    message: local
      ? "로컬 모드: PC 디스크를 서버가 직접 읽습니다."
      : "클라우드 모드: 브라우저 폴더 선택(업로드 다이얼로그 계열)을 사용합니다.",
  });
}
