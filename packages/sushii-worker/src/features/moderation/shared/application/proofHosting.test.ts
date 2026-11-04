import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { downloadProofFile, isDownloadableProofUrl } from "./proofHosting";

const URL_ = "https://cdn.discordapp.com/attachments/1/2/a.png?ex=1&is=2&hm=3&";

describe("downloadProofFile", () => {
  const fetchSpy = spyOn(globalThis, "fetch");
  const options = () => ({
    signal: AbortSignal.timeout(1000),
    maxBytes: 4,
  });

  afterEach(() => {
    fetchSpy.mockReset();
  });

  test("stops reading a body that grows past the cap", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(3));
        controller.enqueue(new Uint8Array(3));
        controller.close();
      },
    });
    fetchSpy.mockResolvedValue(new Response(body));

    expect(await downloadProofFile(URL_, options())).toEqual({
      kind: "too_large",
      bytes: 6,
    });
  });

  test("gone is dead, a server error is worth retrying", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("", { status: 404 }));
    expect(await downloadProofFile(URL_, options())).toEqual({
      kind: "dead",
      status: 404,
    });

    fetchSpy.mockResolvedValueOnce(new Response("", { status: 503 }));
    expect(await downloadProofFile(URL_, options())).toEqual({
      kind: "transient",
      status: 503,
    });
  });

  test("returns the file named after the URL", async () => {
    fetchSpy.mockResolvedValue(
      new Response("png", { headers: { "content-type": "image/png" } }),
    );

    const result = await downloadProofFile(URL_, options());

    expect(result).toMatchObject({
      kind: "ok",
      file: { name: "a.png", contentType: "image/png" },
    });
  });
});

describe("isDownloadableProofUrl", () => {
  test("only Discord's CDN hosts over https", () => {
    expect(isDownloadableProofUrl(URL_)).toBe(true);
    expect(
      isDownloadableProofUrl(
        "https://media.discordapp.net/attachments/1/2/a.png",
      ),
    ).toBe(true);
    expect(isDownloadableProofUrl("https://example.com/a.png")).toBe(false);
    expect(isDownloadableProofUrl("http://cdn.discordapp.com/a.png")).toBe(
      false,
    );
    expect(isDownloadableProofUrl("not a url")).toBe(false);
  });
});
