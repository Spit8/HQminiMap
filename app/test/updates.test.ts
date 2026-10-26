import { describe, expect, it } from "vitest";
import { errorCode } from "../src/lib/state/updates.svelte";

describe("update errors", () => {
  it("tells a missing public release from a connection problem", () => {
    expect(errorCode(new Error("HTTP 404"))).toBe("notFound");
    expect(errorCode("Could not fetch a valid release JSON from the remote: status 404 Not Found")).toBe("notFound");
    expect(errorCode(new Error("HTTP 503"))).toBe("network");
    expect(errorCode(new TypeError("Failed to fetch"))).toBe("network");
    expect(errorCode("signature verification failed")).toBe("signature");
  });
});
