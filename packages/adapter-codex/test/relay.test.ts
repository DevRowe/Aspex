import { describe, expect, test } from "bun:test";
import { runHookRelay } from "../../adapter-claude-code/src/relay";

describe("Codex hook relay", () => {
  test("malformed payload exits quietly without posting", async () => {
    let posts = 0;
    const fetchMock = (async () => {
      posts += 1;
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    await expect(
      runHookRelay({
        source: "codex",
        hubPort: 47321,
        jsonArg: "{not-json",
        fetch: fetchMock,
      }),
    ).resolves.toBeUndefined();

    expect(posts).toBe(0);
  });

  test("codex payload posts to the codex signal endpoint", async () => {
    const requests: Request[] = [];
    const fetchMock = (async (
      input: Parameters<typeof fetch>[0],
      init: Parameters<typeof fetch>[1],
    ) => {
      requests.push(new Request(input, init));
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    await runHookRelay({
      source: "codex",
      hubPort: 47321,
      jsonArg: JSON.stringify({
        type: "agent-turn-complete",
        "thread-id": "abc",
        cwd: "/work/aspex",
      }),
      fetch: fetchMock,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://127.0.0.1:47321/signals/codex");
    await expect(requests[0]?.json()).resolves.toMatchObject({
      id: "codex:session:abc",
      source: "codex",
      state: "done",
    });
  });
});
