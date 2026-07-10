# Voice Grammar

Phase 1 voice is a flat cockpit push-to-talk loop. It is local-first, opt-in,
and server-side: the web client records one Utterance, sends audio plus Voice
context to the Hub, and the Hub performs STT, command grammar parsing, session
reduction, action dispatch, and read-back.

There is no spatial or WebXR voice behavior in Phase 1.

## Safe-Grammar Rules

- No-match never acts. Low confidence, unknown commands, missing referents,
  unavailable actions, and ambiguous project names return `ok: false` with a
  read-back and no adapter dispatch.
- The client cannot authorize an action. It only sends audio and Voice context;
  all grammar, confirmation, dictation, and action availability checks run in
  the Hub.
- A confirmable action arms first. A separate matching confirm-phrase, such as
  `confirm merge`, is required before dispatch.
- Dictation is bounded. Free text is accepted only while Dictation mode is
  active, is read back, and is posted only after `post it` or `send it`.
- Audio and transcripts are data. Transcript text is used only as a closed
  grammar lookup or as a literal dictated body.

## Normalization

Command matching is case-insensitive. Leading/trailing whitespace, repeated
internal whitespace, and trailing `.`, `!`, `?`, `,`, `;`, or `:` are ignored.

The confidence gate runs before every parse, including Dictation mode. A
transcript below `voice.confidenceThreshold` becomes `low_confidence`.

## Voice Context and Referents

Every Utterance carries:

```ts
{
  selectedId?: string;
  needsMeIds: string[];
}
```

Referent rules:

- `read it`, `open it`, `approve`, `deny`, `answer`, `redirect`, `ship`, `re-run`, `merge`, `comment`, `request changes`, and `reject` require `selectedId`.
- Action phrases must be present in the selected Item's `actions` list.
- `focus <project>` is resolved by the Hub against exact project-name matches.
  No match returns `no_referent`. The shipped Hub selects the top matching
  needs-me Item first, then the most recently observed exact match, so ordinary
  duplicate project names are deterministic. The parser can still return
  `ambiguous` if an injected resolver reports an ambiguous match.
- `next` and `previous` move within the current needs-me list.
- `what needs me` does not require a selected Item.
- `dispatch <instruction>` and `status query` are referent-less orchestrator intents and do not require a selected Item.

Phase 1 does not ship ordinal referents such as `the top one` or `the second`.

## Supported Phrases

| Spoken phrase | Intent | Notes |
| --- | --- | --- |
| `what needs me` | `nav` with `{ type: "show_needs_me" }` | Read-back is `Nothing needs you right now.` or `Needs you: <ids>.` |
| `show what needs me` | `nav` with `{ type: "show_needs_me" }` | Same as above. |
| `focus <project>` | `nav` with `{ type: "select", id }` | Read-back is `Focused <id>.` |
| `next` | `nav` with `{ type: "move", delta: 1 }` | Read-back is `Moved to next.` |
| `previous` | `nav` with `{ type: "move", delta: -1 }` | Read-back is `Moved to previous.` |
| `read it` | `read` selected Item | Read-back is the Hub's item summary. |
| `read this` | `read` selected Item | Same as above. |
| `open it` | `open` selected Item | Returns an `{ type: "open", id }` directive; the client opens the Item's `deepLink`. Read-back is `Opening <id>.` |
| `open this` | `open` selected Item | Same as above. |
| `approve` | `action` with `actionId: "approve"` | Dispatches unless the Item action requires confirmation. |
| `deny` | `dictate` with `actionId: "deny"` | Dictates text and then arms when the live Action requires confirmation. |
| `answer` | `dictate` with `actionId: "answer"` | Dictates text and dispatches only when the selected Item offers the Action. |
| `redirect` | `dictate` with `actionId: "redirect"` | Dictates text and then arms when the live Action requires confirmation. |
| `ship` / `review and ship` | `action` with `actionId: "ship"` | Arms when the live Action requires confirmation; it never merges from this utterance alone. |
| `dispatch <instruction>` | referent-less `dispatch_task` | Always arms and requires a separate `confirm dispatch`; the resulting Item arrives through the world-model stream. |
| `status` / `status query` | referent-less `status_query` | Calls the existing `/intents` status-query handler and returns its read-back. |
| `re-run` | `action` with `actionId: "rerun"` | Dispatches unless the Item action requires confirmation. |
| `re-run checks` | `action` with `actionId: "rerun"` | Same as above. |
| `merge` | `action` with `actionId: "merge"` | Arms if `requiresConfirmation` is true. |
| `confirm <verb>` | `confirm` pending action | Only works when `<verb>` maps to the current pending action, including orchestrator verbs offered by the selected Item. |
| `confirm dispatch` | `confirm_dispatch` | Delivers only the currently armed dispatch and reuses its original client `intentId`. |
| `cancel` | `cancel` | Clears pending confirmation or Dictation mode. |
| `never mind` | `cancel` | Same as above. |
| `comment` | `dictate` with `actionId: "comment"` | Enters Dictation mode. |
| `request changes` | `dictate` with `actionId: "request_changes"` | Enters Dictation mode. |
| `reject` | `dictate` with `actionId: "request_changes"` | Same as above. |

## Confirmation

When an action's metadata has `requiresConfirmation: true`, the first utterance
does not dispatch. The Hub stores:

```ts
pendingConfirm: {
  itemId: string;
  actionId: string;
  label: string;
  armedAt: string;
  intentId?: string;
  payload?: unknown;
}
```

The read-back is:

```text
Say 'confirm <actionId>' to <label> <itemId>.
```

For example, merge usually reads back `Say 'confirm merge' to Merge <itemId>.`
The matching confirm dispatches once with payload `{ confirmed: true }` and
clears `pendingConfirm`.

`ship` is distinct: it reads back `Say 'merge' or 'ship'` and only either
spoken word confirms it.
The Hub forwards that captured `mergeWord` with `confirmed: true`, and the
Giles adapter refuses a ship direction without it.

The pending confirm expires after `voice.confirmTtlMs`. A recognized navigation,
read, open, action, or dictation command clears it. A parser `no_match` leaves it
in place. A mismatched recognized confirm returns `unknown_command` and clears
it.

A referent-less dispatch uses a sibling `pendingDispatch` record containing the client `intentId`, orchestrator, instruction, and `armedAt` time.
The first dispatch utterance never calls the orchestrator, while `confirm dispatch` delivers exactly that stored intent.
`POST /voice/cancel` clears only the caller's server-side arm or dictation
session without delivering an action or intent.

## Dictation

`comment`, `request changes`, `reject`, `deny`, `answer`, and `redirect` enter Dictation mode for the selected Item.
The prompt read-back is:

```text
Dictate your <label>, then say 'post it'.
```

The label is `comment` for comments and `changes` for request-changes.

While Dictation mode is active:

- `post it` and `send it` attempt to post the pending dictated body.
- `cancel` and `never mind` clear Dictation mode and read back `Cancelled.`
- Any other high-confidence transcript becomes the literal dictation body.

Dictated body read-back is:

```text
I heard: <body>. Say 'post it' to send, or 'cancel'.
```

Posting dispatches the original action with payload `{ body: "<body>" }` and
clears Dictation mode. In Dictation mode, `post it` before any body returns
`unknown_command` and leaves Dictation mode active. Outside Dictation mode,
`post it` and `send it` are unknown commands.

## No-Match Reasons

| Reason | When it happens | Read-back |
| --- | --- | --- |
| `low_confidence` | STT confidence is below `voice.confidenceThreshold`. | `I couldn't hear that clearly.` |
| `unknown_command` | The phrase is not in the grammar, confirm does not match a pending action, `post it` is spoken outside Dictation mode, or `post it` has no dictated body. | `I didn't understand that command.` |
| `no_referent` | A selected Item or focus target is required but missing. | `I need an item selected first.` |
| `action_unavailable` | The selected Item does not expose the requested action id. | `That action is not available for this item.` |
| `ambiguous` | The injected project resolver reports that `focus <project>` matched more than one Item. | `That matched more than one item.` |

If STT itself fails before a transcript is returned, the gateway returns
`ok: false` with `I couldn't hear that.`

`cancel` and `never mind` are recognized commands, not no-match cases. They
return `ok: true` with `Cancelled.` even if there is no pending state to clear.

## Client Behavior

The web client captures audio only while the push-to-talk button or configured
hold key is pressed. The default key is `Space`. Key capture is suppressed inside
editable controls.

The Hub always returns text read-back. If TTS succeeds, the HTTP route returns a
short-lived `/voice/audio/<id>` URL containing cached WAV bytes; if TTS is off or
fails, `audioUrl` is omitted and the text read-back remains authoritative.
The web client authenticates the utterance and audio-fetch requests with the Hub
bearer token, the same as the rest of the Hub HTTP API.
