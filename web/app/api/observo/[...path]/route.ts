import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.OBSERVO_API_URL || "http://localhost:8080";

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = new URL(req.url);
  const target = `${BACKEND}/${path.join("/")}${url.search}`;

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!["host", "connection"].includes(k)) headers.set(k, v);
  });

  const body = req.method === "GET" || req.method === "HEAD" ? undefined : req.body;

  const res = await fetch(target, {
    method: req.method,
    headers,
    body,
    // @ts-expect-error
    duplex: "half",
  });

  const resHeaders = new Headers();
  res.headers.forEach((v, k) => resHeaders.set(k, v));
  resHeaders.set("Access-Control-Allow-Origin", "*");

  return new NextResponse(res.body, {
    status: res.status,
    headers: resHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-API-Key",
    },
  });
}
