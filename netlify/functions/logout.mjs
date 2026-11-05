import { setCookie } from "../lib/auth.mjs";
export default async () => new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": setCookie("", 0), "Cache-Control": "no-store" } });
export const config = { path: "/api/logout" };
