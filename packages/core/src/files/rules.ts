export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_FILE_NAME_LENGTH = 200;

export const FILE_PURPOSES = ["delivery"] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

const OCTET_STREAM = "application/octet-stream";

// The server decides the content type from the extension; what the browser claims is never trusted.
// Anything that browsers could render as a page (html, xml, js) is left out on purpose.
const CONTENT_TYPES: Record<string, string> = {
  // Archives
  zip: "application/zip",
  "7z": OCTET_STREAM,
  rar: OCTET_STREAM,
  tar: "application/x-tar",
  gz: "application/gzip",
  tgz: OCTET_STREAM,
  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  epub: "application/epub+zip",
  // Images and design
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  psd: OCTET_STREAM,
  ai: OCTET_STREAM,
  eps: OCTET_STREAM,
  fig: OCTET_STREAM,
  sketch: OCTET_STREAM,
  xd: OCTET_STREAM,
  // Audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  // Video
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  // Fonts
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  // 3D and game assets
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  fbx: OCTET_STREAM,
  obj: OCTET_STREAM,
  stl: OCTET_STREAM,
  blend: OCTET_STREAM,
  unitypackage: OCTET_STREAM,
};

export const ALLOWED_FILE_EXTENSIONS: readonly string[] = Object.keys(CONTENT_TYPES);

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

export function fileContentType(name: string): string | null {
  const extension = extensionOf(name);
  if (!extension || !Object.hasOwn(CONTENT_TYPES, extension)) return null;
  return CONTENT_TYPES[extension] ?? null;
}

const CONTROL_OR_QUOTE = /[\u0000-\u001f\u007f"]/g;

export function safeFileName(name: string): string | null {
  const lastSegment = name.split(/[\\/]/).pop() ?? "";
  const cleaned = lastSegment.replace(CONTROL_OR_QUOTE, "").trim();
  if (!cleaned) return null;
  if (cleaned.length <= MAX_FILE_NAME_LENGTH) return cleaned;

  const extension = extensionOf(cleaned);
  const suffix = extension && extension.length < 20 ? `.${extension}` : "";
  return cleaned.slice(0, MAX_FILE_NAME_LENGTH - suffix.length) + suffix;
}

// RFC 5987: encodeURIComponent leaves ' ( ) * alone, but they are not allowed in an ext-value.
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function attachmentDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\u0020-\u007e]|["\\]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}

export function fileProblem(file: { name: string; sizeBytes: number }): string | null {
  if (!fileContentType(file.name)) return "This file type is not allowed.";
  if (file.sizeBytes < 1) return "The file is empty.";
  if (file.sizeBytes > MAX_FILE_BYTES) return `Files can be up to ${formatBytes(MAX_FILE_BYTES)}.`;
  return null;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Math.round(value * 10) / 10} ${BYTE_UNITS[unit]}`;
}
