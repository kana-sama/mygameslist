const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

export const YOUTUBE_UPLOAD_URL = "https://www.youtube.com/upload";

export interface YouTubeVideoUrl {
  videoId: string;
  canonicalUrl: string;
  embedUrl: string;
}

function withProtocol(value: string): string {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

function pathVideoId(pathname: string, route: "shorts" | "live" | "embed"): string | null {
  const match = pathname.match(new RegExp(`^/${route}/([A-Za-z0-9_-]{11})/?$`));
  return match?.[1] ?? null;
}

function extractVideoId(url: URL): string | null {
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;

  if (url.hostname === "youtu.be") {
    const match = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/);
    return match?.[1] ?? null;
  }

  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;
  if (url.pathname === "/watch" || url.pathname === "/watch/") {
    const values = url.searchParams.getAll("v");
    return values.length === 1 && VIDEO_ID_PATTERN.test(values[0]) ? values[0] : null;
  }

  return pathVideoId(url.pathname, "shorts")
    ?? pathVideoId(url.pathname, "live")
    ?? pathVideoId(url.pathname, "embed");
}

export function parseYouTubeUrl(value: string): YouTubeVideoUrl | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("/")) return null;

  let url: URL;
  try {
    url = new URL(withProtocol(trimmed));
  } catch {
    return null;
  }

  const videoId = extractVideoId(url);
  if (!videoId) return null;
  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1`,
  };
}

export function normalizeYouTubeUrl(value: string): string | null {
  return parseYouTubeUrl(value)?.canonicalUrl ?? null;
}

export function getYouTubeEmbedUrl(value: string): string | null {
  return parseYouTubeUrl(value)?.embedUrl ?? null;
}
