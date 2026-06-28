import { describe, expect, test } from "bun:test";
import { runHookRelay } from "../src/relay";

describe("Claude Code hook relay", () => {
  test("defaults to claude-code source and reads hook JSON from stdin", async () => {
    const requests: Request[] = [];
    const fetchMock = (async (
      input: Parameters<typeof fetch>[0],
      init: Parameters<typeof fetch>[1],
    ) => {
      requests.push(new Request(input, init));
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    await runHookRelay({
      event: "Notification",
      hubPort: 47321,
      stdin: streamFromString(
        JSON.stringify({
          session_id: "abc",
          cwd: "/work/aspex",
          message: "Approve the next command?",
        }),
      ),
      fetch: fetchMock,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://127.0.0.1:47321/signals/claude-code");
    await expect(requests[0]?.json()).resolves.toMatchObject({
      id: "claude-code:session:abc",
      source: "claude-code",
      state: "blocked",
      attentionRequired: true,
    });
  });
});

function streamFromString(input: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(input));
      controller.close();
    },
  });
}
