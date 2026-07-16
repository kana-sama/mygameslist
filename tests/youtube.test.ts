import {
  getYouTubeEmbedUrl,
  normalizeYouTubeUrl,
  parseYouTubeUrl,
} from "../src/domain";

const VIDEO_ID = "dQw4w9WgXcQ";
const CANONICAL_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

describe("YouTube URLs", () => {
  it.each([
    `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    `https://youtube.com/watch?v=${VIDEO_ID}&t=42`,
    `https://m.youtube.com/watch?v=${VIDEO_ID}#watching`,
    `https://youtu.be/${VIDEO_ID}?si=share-token`,
    `https://www.youtube.com/shorts/${VIDEO_ID}`,
    `https://www.youtube.com/live/${VIDEO_ID}?feature=share`,
    `https://www.youtube.com/embed/${VIDEO_ID}`,
    `youtu.be/${VIDEO_ID}`,
  ])("normalizes %s", (url) => {
    expect(normalizeYouTubeUrl(url)).toBe(CANONICAL_URL);
  });

  it("returns the video ID and privacy-enhanced embed URL", () => {
    expect(parseYouTubeUrl(CANONICAL_URL)).toEqual({
      videoId: VIDEO_ID,
      canonicalUrl: CANONICAL_URL,
      embedUrl: `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?playsinline=1`,
    });
    expect(getYouTubeEmbedUrl(CANONICAL_URL)).toBe(
      `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?playsinline=1`,
    );
  });

  it.each([
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://youtube.com@evil.test/watch?v=dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://www.youtu.be/dQw4w9WgXcQ",
  ])("rejects spoofed or unsupported domain %s", (url) => {
    expect(parseYouTubeUrl(url)).toBeNull();
  });

  it.each([
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/watch?list=PL123",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=aaaaaaaaaaa",
    "https://youtu.be/dQw4w9WgXcQ/extra",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ/extra",
    "https://www.youtube.com/watch?v=dQw4w9WgXc!",
    "/watch?v=dQw4w9WgXcQ",
    "not a URL",
    "",
  ])("rejects a playlist-only or malformed URL: %s", (url) => {
    expect(normalizeYouTubeUrl(url)).toBeNull();
  });
});
