// Capture a screenshot of a public URL. We use Microlink's free public API by
// default — no key required, generous-but-finite free tier (~50 req/day per
// IP). For higher volume set MICROLINK_API_KEY (paid plan) and we'll add it.
//
// Returns: { data, mediaType, url }  — base64 data of the rendered PNG.

const MICROLINK_BASE = "https://api.microlink.io/";
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

export async function captureScreenshot(targetUrl, opts = {}) {
  const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
  const params = new URLSearchParams({
    url: targetUrl,
    screenshot: "true",
    "viewport.width": String(viewport.width),
    "viewport.height": String(viewport.height),
    waitForTimeout: "2000",
    "screenshot.fullPage": "false",
    "screenshot.type": "png",
    meta: "false",
  });

  const headers = { Accept: "application/json" };
  if (process.env.MICROLINK_API_KEY) {
    headers["x-api-key"] = process.env.MICROLINK_API_KEY;
  }

  const apiUrl = `${MICROLINK_BASE}?${params.toString()}`;
  const resp = await fetch(apiUrl, { headers });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.status !== "success") {
    const reason =
      json?.message ?? json?.code ?? `HTTP ${resp.status}`;
    throw new Error(`microlink screenshot failed: ${reason}`);
  }

  const screenshotUrl = json?.data?.screenshot?.url;
  if (!screenshotUrl) {
    throw new Error("microlink returned no screenshot url");
  }

  // Fetch the actual image bytes.
  const imgResp = await fetch(screenshotUrl);
  if (!imgResp.ok) {
    throw new Error(`screenshot fetch failed: HTTP ${imgResp.status}`);
  }
  const ct = imgResp.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await imgResp.arrayBuffer());
  return {
    data: buf.toString("base64"),
    mediaType: ct.split(";")[0].trim(),
    url: screenshotUrl,
  };
}

// Minimal HTML fetch + crude text extraction for accessibility-relevant bits.
// We don't render JS — this is just to surface alt attributes, headings,
// title, meta description, and ARIA labels for the model to reason about.
export async function fetchPageDigest(targetUrl, { maxBytes = 1_500_000 } = {}) {
  const resp = await fetch(targetUrl, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; design-intelligence-portal/0.2; +https://refero.design)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!resp.ok) {
    throw new Error(`page fetch failed: HTTP ${resp.status}`);
  }
  const reader = resp.body?.getReader?.();
  if (!reader) {
    const text = await resp.text();
    return digestFromHtml(text.slice(0, maxBytes));
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) break;
      chunks.push(value);
    }
  }
  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return digestFromHtml(merged.toString("utf8"));
}

function digestFromHtml(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const description =
    (
      html.match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
      )?.[1] ||
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
      )?.[1] ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);

  const headings = [];
  const hRe = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = hRe.exec(html)) !== null && headings.length < 60) {
    const level = m[1].toLowerCase();
    const text = stripTags(m[2]).slice(0, 140);
    if (text) headings.push({ level, text });
  }

  // Images and their alt text — flag missing/empty alt.
  const images = [];
  const imgRe = /<img\b([^>]*)>/gi;
  while ((m = imgRe.exec(html)) !== null && images.length < 80) {
    const attrs = m[1];
    const src = attrs.match(/\bsrc=["']([^"']+)["']/i)?.[1] || "";
    const altMatch = attrs.match(/\balt=["']([^"']*)["']/i);
    const hasAlt = !!altMatch;
    const alt = altMatch?.[1] ?? null;
    images.push({ src: src.slice(0, 200), hasAlt, alt: alt?.slice(0, 140) ?? null });
  }

  // ARIA labels and roles count (rough signal).
  const ariaLabelCount = (html.match(/\baria-label=/gi) ?? []).length;
  const roleCount = (html.match(/\brole=/gi) ?? []).length;
  const buttonCount = (html.match(/<button\b/gi) ?? []).length;
  const linkCount = (html.match(/<a\b/gi) ?? []).length;

  return {
    title,
    description,
    headings,
    images,
    counts: {
      images: images.length,
      imagesMissingAlt: images.filter((i) => !i.hasAlt).length,
      imagesEmptyAlt: images.filter((i) => i.hasAlt && !i.alt).length,
      buttons: buttonCount,
      links: linkCount,
      ariaLabels: ariaLabelCount,
      roles: roleCount,
    },
  };
}

function stripTags(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
