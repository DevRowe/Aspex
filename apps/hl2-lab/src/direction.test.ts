import { describe, expect, test } from "bun:test";
import { DirectionClient } from "./direction";

describe("DirectionClient", () => {
  test("routes item verbs only through /actions and reuses the logical intent id on retry", async () => {
    const requests: Request[] = [];
    const client = new DirectionClient(
      () => ({ hubUrl: "https://hub.test/", token: "token" }),
      ((input, init) => {
        requests.push(new Request(input, init));
        return Promise.resolve(Response.json({ ok: true, message: "queued" }));
      }) as typeof fetch,
    );
    const operation = client.beginAction("orchestrator:giles:task", "answer", {
      text: "Use A",
    });
    await client.action(operation);
    await client.action(operation);
    const bodies = await Promise.all(requests.map((request) => request.json()));
    expect(requests[0]?.url).toBe(
      "https://hub.test/actions/orchestrator%3Agiles%3Atask/answer",
    );
    expect(bodies[0].intentId).toBe(operation.intentId);
    expect(bodies[1].intentId).toBe(operation.intentId);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer token");
  });

  test("routes dispatch and status query only through /intents", async () => {
    const bodies: unknown[] = [];
    const urls: string[] = [];
    const client = new DirectionClient(
      () => ({ hubUrl: "https://hub.test", token: "token" }),
      ((input, init) => {
        urls.push(String(input));
        bodies.push(JSON.parse(String(init?.body)));
        return Promise.resolve(
          Response.json({ ok: true, message: "ok" }, { status: 202 }),
        );
      }) as typeof fetch,
    );
    await client.dispatch(client.beginDispatch("Build it", "Aspex"), true);
    await client.statusQuery();
    expect(urls).toEqual([
      "https://hub.test/intents",
      "https://hub.test/intents",
    ]);
    expect((bodies[0] as { verb: string }).verb).toBe("dispatch");
    expect((bodies[1] as { verb: string }).verb).toBe("status_query");
  });

  test("surfaces the Hub 409 as an arm request without retrying automatically", async () => {
    let calls = 0;
    const client = new DirectionClient(
      () => ({ hubUrl: "https://hub.test", token: "token" }),
      (() => {
        calls += 1;
        return Promise.resolve(
          Response.json(
            { message: "Action requires confirmation" },
            { status: 409 },
          ),
        );
      }) as unknown as typeof fetch,
    );
    const result = await client.action(client.beginAction("item", "redirect"));
    expect(result.kind).toBe("confirmation_required");
    expect(calls).toBe(1);
  });

  test("does not send a confirmed ship action without a merge word", async () => {
    let calls = 0;
    const client = new DirectionClient(
      () => ({ hubUrl: "https://hub.test", token: "token" }),
      (() => {
        calls += 1;
        return Promise.resolve(Response.json({ ok: true }));
      }) as unknown as typeof fetch,
    );

    const result = await client.action(
      client.beginAction("orchestrator:giles:task", "ship"),
      true,
    );

    expect(result).toMatchObject({ kind: "failed", retryable: false });
    expect(calls).toBe(0);
  });

  test("sends the merge word alongside a confirmed ship action", async () => {
    const requests: Request[] = [];
    const client = new DirectionClient(
      () => ({ hubUrl: "https://hub.test", token: "token" }),
      ((input, init) => {
        requests.push(new Request(input, init));
        return Promise.resolve(Response.json({ ok: true, message: "queued" }));
      }) as typeof fetch,
    );
    const operation = client.beginAction("orchestrator:giles:task", "ship", {
      mergeWord: "merge",
    });

    await client.action(operation, true);

    expect(await requests[0]?.json()).toMatchObject({
      confirmed: true,
      payload: { mergeWord: "merge" },
    });
  });
});
