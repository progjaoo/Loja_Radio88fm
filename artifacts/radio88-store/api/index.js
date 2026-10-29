import app from "../../api-server/dist/vercel.mjs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(req, res) {
  const requestUrl = new URL(req.url ?? "/", "http://vercel.local");
  const originalPath = requestUrl.searchParams.get("__path");

  if (!originalPath || !originalPath.startsWith("/api/")) {
    return res.status(400).json({ error: "Invalid API route." });
  }

  requestUrl.searchParams.delete("__path");
  req.url = `${originalPath}${requestUrl.search}`;

  return app(req, res);
}
