import { describe, expect, it } from "vitest";

import { fromBase64File, toBase64File } from "../src/files";

describe("file conversion", () => {
  it("reads every legacy body type", async () => {
    expect(await toBase64File(new Blob(["hi"], { type: "text/plain" }))).toEqual({ mimetype: "text/plain", base64: "aGk=" });
    expect(await toBase64File(new Blob(["hi"]))).toEqual({ base64: "aGk=" });
    expect(await toBase64File(new Uint8Array([104, 105]).buffer)).toEqual({ base64: "aGk=" });
    expect(await toBase64File("hi")).toEqual({ mimetype: "text/plain;charset=UTF-8", base64: "aGk=" });
    expect(await toBase64File({ base64: "aGk=" })).toEqual({ base64: "aGk=" });
  });

  it("round-trips large binary files", async () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    const file = await toBase64File(new Blob([bytes], { type: "application/octet-stream" }));
    const back = new Uint8Array(await fromBase64File(file).arrayBuffer());
    expect(back).toEqual(bytes);
    expect(fromBase64File(file).type).toBe("application/octet-stream");
  });
});
