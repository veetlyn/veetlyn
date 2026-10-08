import { describe, expect, it } from "vitest";

import {
  ALLOWED_FILE_EXTENSIONS,
  attachmentDisposition,
  checkUploadFile,
  fileContentType,
  fileProblem,
  formatBytes,
  MAX_FILE_BYTES,
  safeFileName,
} from "./rules";

describe("fileContentType", () => {
  it("decides the type from the extension, ignoring case", () => {
    expect(fileContentType("Logo Final.PDF")).toBe("application/pdf");
    expect(fileContentType("brand.zip")).toBe("application/zip");
    expect(fileContentType("model.blend")).toBe("application/octet-stream");
    expect(fileContentType("song.mp3")).toBe("audio/mpeg");
  });

  it("refuses unknown or missing extensions", () => {
    expect(fileContentType("run.exe")).toBeNull();
    expect(fileContentType("noext")).toBeNull();
    expect(fileContentType(".env")).toBeNull();
    expect(fileContentType("a.html")).toBeNull();
    expect(fileContentType("a.svg.exe")).toBeNull();
  });

  it("knows a type for every allowed extension", () => {
    for (const extension of ALLOWED_FILE_EXTENSIONS) {
      expect(fileContentType(`file.${extension}`)).toEqual(expect.any(String));
    }
  });
});

describe("safeFileName", () => {
  it("keeps only the last path segment", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\me\\logo.png")).toBe("logo.png");
  });

  it("removes control characters and double quotes", () => {
    expect(safeFileName('my\u0000 "best"\u001f\u007f logo.png')).toBe("my best logo.png");
  });

  it("cuts long names but keeps the extension", () => {
    const name = safeFileName(`${"a".repeat(300)}.psd`);

    expect(name).toHaveLength(200);
    expect(name?.endsWith(".psd")).toBe(true);
  });

  it("never cuts a character in half", () => {
    const name = safeFileName(`${"a".repeat(195)}😀😀.zip`);

    expect(name?.isWellFormed()).toBe(true);
    expect(name?.endsWith(".zip")).toBe(true);
    expect(() => attachmentDisposition(name ?? "")).not.toThrow();
  });

  it("repairs lone surrogates", () => {
    expect(safeFileName("\ud800.pdf")?.isWellFormed()).toBe(true);
  });

  it("removes bidi and invisible controls", () => {
    expect(safeFileName("photo\u202Egnp.zip")).toBe("photognp.zip");
    expect(safeFileName("\ufeffa\u200e\u2066b\u2069\u0085\u2028.pdf")).toBe("ab.pdf");
  });

  it("normalizes to NFC", () => {
    expect(safeFileName("cafe\u0301.pdf")).toBe("caf\u00e9.pdf");
  });

  it("refuses blank names", () => {
    expect(safeFileName("   ")).toBeNull();
    expect(safeFileName("folder/")).toBeNull();
  });
});

describe("attachmentDisposition", () => {
  it("sends both the plain and the encoded file name", () => {
    expect(attachmentDisposition("Logo final.pdf")).toBe(
      `attachment; filename="Logo final.pdf"; filename*=UTF-8''Logo%20final.pdf`,
    );
  });

  it("uses an ASCII fallback for non-ASCII names", () => {
    expect(attachmentDisposition("café.pdf")).toBe(`attachment; filename="caf_.pdf"; filename*=UTF-8''caf%C3%A9.pdf`);
  });

  it("does not throw on lone surrogates", () => {
    expect(() => attachmentDisposition("\ud800.pdf")).not.toThrow();
    expect(attachmentDisposition("\ud800.pdf")).toBe(`attachment; filename="_.pdf"; filename*=UTF-8''%EF%BF%BD.pdf`);
  });

  it("encodes the characters encodeURIComponent leaves alone", () => {
    expect(attachmentDisposition("it's (final)*.pdf")).toBe(
      `attachment; filename="it's (final)*.pdf"; filename*=UTF-8''it%27s%20%28final%29%2A.pdf`,
    );
  });
});

describe("fileProblem", () => {
  it("accepts allowed files within the size limit", () => {
    expect(fileProblem({ name: "brand.zip", sizeBytes: 1 })).toBeNull();
    expect(fileProblem({ name: "brand.zip", sizeBytes: MAX_FILE_BYTES })).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(fileProblem({ name: "run.exe", sizeBytes: 10 })).toBe("This file type is not allowed.");
    expect(fileProblem({ name: "brand.zip", sizeBytes: 0 })).toBe("The file is empty.");
    expect(fileProblem({ name: "brand.zip", sizeBytes: MAX_FILE_BYTES + 1 })).toBe("Files can be up to 100 MB.");
  });

  it("caps files at 100 MB", () => {
    expect(MAX_FILE_BYTES).toBe(100 * 1024 * 1024);
  });
});

describe("checkUploadFile", () => {
  it("returns the cleaned name and the type decided from it", () => {
    expect(checkUploadFile({ name: "brand.zip ", sizeBytes: 10 })).toEqual({
      ok: true,
      fileName: "brand.zip",
      contentType: "application/zip",
    });
    expect(checkUploadFile({ name: "../../uploads/Logo.PNG", sizeBytes: 10 })).toEqual({
      ok: true,
      fileName: "Logo.PNG",
      contentType: "image/png",
    });
  });

  it("refuses nameless, disallowed, empty and oversized files", () => {
    expect(checkUploadFile({ name: "   ", sizeBytes: 10 })).toEqual({ ok: false, problem: "Give the file a name." });
    expect(checkUploadFile({ name: "folder/", sizeBytes: 10 })).toEqual({ ok: false, problem: "Give the file a name." });
    expect(checkUploadFile({ name: "run.exe", sizeBytes: 10 })).toEqual({
      ok: false,
      problem: "This file type is not allowed.",
    });
    expect(checkUploadFile({ name: "brand.zip", sizeBytes: 0 })).toEqual({ ok: false, problem: "The file is empty." });
    expect(checkUploadFile({ name: "brand.zip", sizeBytes: MAX_FILE_BYTES + 1 })).toEqual({
      ok: false,
      problem: "Files can be up to 100 MB.",
    });
  });
});

describe("formatBytes", () => {
  it("uses 1024-based units with one decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1_536)).toBe("1.5 KB");
    expect(formatBytes(MAX_FILE_BYTES)).toBe("100 MB");
    expect(formatBytes(5_400_000)).toBe("5.1 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3 GB");
  });
});
