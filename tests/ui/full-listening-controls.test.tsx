import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
  url: "http://localhost/listening",
});
for (const k of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLAnchorElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "localStorage",
  "sessionStorage",
] as const)
  Object.defineProperty(globalThis, k, {
    value: dom.window[k],
    configurable: true,
  });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis });
dom.window.HTMLMediaElement.prototype.pause = () => {};
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import(
  "next/dist/shared/lib/app-router-context.shared-runtime"
);
const { NativeListeningExam } = await import(
  "../../src/components/listening/NativeListeningExam"
);
const { FullListeningActivity } = await import(
  "../../src/components/listening/FullListeningActivity"
);
const { FullListeningLibrary } = await import(
  "../../src/components/listening/FullListeningLibrary"
);
const router = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
};
async function mount(element: React.ReactElement, run: () => Promise<void>) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  try {
    await act(async () =>
      root.render(
        React.createElement(
          AppRouterContext.Provider,
          { value: router as never },
          element,
        ),
      ),
    );
    await run();
  } finally {
    await act(async () => root.unmount());
  }
}
const id = "00000000-0000-4000-8000-000000000001";
const examProps = {
  dict: en,
  attemptId: id,
  testId: id,
  title: "Source test",
  audioUrl: "/canonical.mp3",
  imageUrl: null,
  questions: [
    {
      id,
      number: 1,
      section: 1,
      text: "Weekly rent ___",
      instruction: "One answer",
      options: [],
    },
  ],
  initial: { [id]: "80" },
  audioPosition: 0,
  audioStartedAt: null,
  duration: 1645,
};
test("Full Exam has no seeking controls, transcript, lexical popups or answer key; submit failure retains the answer", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("<html>failed</html>", { status: 503 });
  try {
    await mount(
      React.createElement(NativeListeningExam, examProps),
      async () => {
        assert.equal(
          document.querySelector("audio")?.hasAttribute("controls"),
          false,
        );
        assert.equal(document.querySelector("[data-clickable-text]"), null);
        assert.equal(
          document
            .querySelector("input[type=range]")
            ?.getAttribute("aria-label"),
          "Volume",
        );
        await act(async () =>
          Array.from(document.querySelectorAll("button"))
            .find((b) => b.textContent === "Submit exam")!
            .click(),
        );
        await act(async () =>
          Array.from(document.querySelectorAll("button"))
            .find((b) => b.textContent === "Confirm submit")!
            .click(),
        );
        assert.equal(
          document.querySelector<HTMLInputElement>('input[maxlength="500"]')
            ?.value,
          "80",
        );
        assert.ok(document.querySelector("[role=alert]")?.textContent);
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("Vocabulary mounts without an audio element and makes zero media or API requests", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("unexpected");
  };
  try {
    await mount(
      React.createElement(FullListeningActivity, {
        id,
        userId: "qa-user",
        title: "Only this source",
        activity: 5,
        audioUrl: null,
        initial: {},
        dict: en,
        data: {
          vocabulary: [
            {
              senseId: "11111111-1111-4111-8111-111111111111",
              occurrenceId: null,
              term: "keen",
              partOfSpeech: "adjective",
              translationUz: "ishtiyoqli",
              definitionEn: "very interested",
              lexicalType: "word",
              ipa: null,
              example: "I am keen.",
              also: ["eager"],
              quiz: {
                q: "Meaning?",
                options: ["interested", "tired"],
                correct: 0,
              },
            },
          ],
        },
      }),
      async () => {
        assert.equal(document.querySelector("audio,video,iframe"), null);
        assert.equal(calls, 0);
        assert.ok(document.body.textContent?.includes("keen"));
        const example = document.querySelector(".academic-text");
        assert.equal(example?.textContent, "I am keen.");
        assert.equal(example?.tagName, "DIV", "lexical text uses a block-safe parent without hydration repair");
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("a dedicated MCQ package is listed under its own collection, never as an Academic full test", async () => {
  await mount(
    React.createElement(FullListeningLibrary, {
      dict: en,
      cards: [
        { id, title: "Formal Academic Test 1", duration: 1800, completed: 0, started: false, collection: "academic" },
        { id: "m1", title: "MCQ Mastery Pack", duration: 600, completed: 0, started: false, collection: "mcq" },
        { id: "q1", title: "Question-type Pack", duration: 600, completed: 0, started: false, collection: "question_types" },
      ],
    }),
    async () => {
      const tab = (label: string) =>
        Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(label))!;
      // The library opens on the academic tab and offers the formal test only.
      assert.match(tab("🎧 Academic Listening").textContent!, /\(1\)/, "the academic tab counts only academic cards");
      assert.ok(document.body.textContent?.includes("Formal Academic Test 1"));
      assert.equal(document.body.textContent?.includes("MCQ Mastery Pack"), false, "a dedicated MCQ package is not an academic full test");
      assert.equal(document.body.textContent?.includes("Question-type Pack"), false);

      // Its own collection tab shows it, with its own count — nothing was deleted or relabelled.
      await act(async () => tab("🔑 MCQ Mastery").click());
      assert.ok(document.body.textContent?.includes("MCQ Mastery Pack"));
      assert.equal(document.body.textContent?.includes("Formal Academic Test 1"), false);
      await act(async () => tab("📚 Question types").click());
      assert.ok(document.body.textContent?.includes("Question-type Pack"));
    },
  );
});

test("Library search and category filters operate locally without reloading or fetching audio", async () => {
  await mount(
    React.createElement(FullListeningLibrary, {
      dict: en,
      cards: [
        {
          id,
          title: "Full Listening 10",
          duration: 1645,
          completed: 2,
          started: true,
          // This card is a package card, so it is filed under a collection. Without one it is
          // honestly UNCATEGORISED (the library no longer falls back to "academic"), which is
          // the correct tab for a row that proves nothing — asserted in its own test.
          collection: "academic",
        },
      ],
    }),
    async () => {
      assert.equal(document.querySelector("audio"), null);
      assert.equal(Array.from(document.querySelectorAll("button")).some(b => b.textContent?.includes("Section 1")), false);
      assert.ok(document.body.textContent?.includes("2 / 5 completed"));
      await act(async () =>
        Array.from(document.querySelectorAll("button"))
          .find((b) => b.textContent?.includes("General Listening"))!
          .click(),
      );
      assert.equal(document.querySelectorAll("article").length, 0);
      assert.equal(document.body.textContent?.includes("Section 1"), false);
      assert.ok(document.body.textContent?.includes("No matching published"));
    },
  );
});

test("Activity draft resumes only for its owner and canonical source", async () => {
  const key = `la-listening-activity:qa-user:${id}:3`;
  sessionStorage.setItem(key, JSON.stringify({ "4": "bring = bring along" }));
  const props = {
    id,
    userId: "qa-user",
    title: "Draft",
    activity: 3,
    audioUrl: null,
    initial: {},
    dict: en,
    data: {
      keyword1: [
        {
          q: 4,
          at: 1,
          end: 2,
          text: "asked",
          heard: "heard",
          link: "bring = bring along",
        },
      ],
    },
  };
  try {
    await mount(React.createElement(FullListeningActivity, props), async () => {
      assert.equal(
        document.querySelector("textarea")?.value,
        "bring = bring along",
      );
    });
    await mount(
      React.createElement(FullListeningActivity, {
        ...props,
        userId: "another-user",
      }),
      async () => {
        assert.equal(document.querySelector("textarea")?.value, "");
      },
    );
  } finally {
    sessionStorage.removeItem(key);
  }
});

const { FullListeningStudy } = await import(
  "../../src/components/listening/FullListeningStudy"
);
test("Controlled study offers audio controls and lexical text without enabling an empty check", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response("{}", { status: 503 });
  };
  try {
    await mount(
      React.createElement(FullListeningStudy, {
        id,
        userId: "qa-study",
        title: "Study",
        audioUrl: "/canonical.mp3",
        imageUrl: null,
        questions: [
          {
            number: 1,
            section: 1,
            text: "Weekly rent",
            instruction: "One word",
            options: [],
          },
        ],
        sections: [
          { number: 1, title: "Rent", transcript: "Weekly rent is eighty." },
        ],
        dict: en,
        lexicalAssistance: true,
      }),
      async () => {
        assert.equal(
          document.querySelector("audio")?.hasAttribute("controls"),
          true,
        );
        assert.ok(document.querySelector("[data-clickable-text]"));
        assert.equal(
          Array.from(document.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Check practice"),
          )?.disabled,
          true,
        );
        assert.equal(calls, 0);
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("Controlled study restores only this owner/source draft and retains it when check fails", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response("failed", { status: 503 });
  };
  sessionStorage.setItem(
    `la-listening-study:qa-study:${id}`,
    JSON.stringify({ 1: "80" }),
  );
  try {
    await mount(
      React.createElement(FullListeningStudy, {
        id,
        userId: "qa-study",
        title: "Study",
        audioUrl: "/canonical.mp3",
        imageUrl: null,
        questions: [
          {
            number: 1,
            section: 1,
            text: "Weekly rent",
            instruction: "One word",
            options: [],
          },
        ],
        sections: [{ number: 1, title: "Section 1", transcript: "" }],
        dict: en,
      }),
      async () => {
        const button = Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent?.includes("Check practice"),
        )!;
        await act(async () => button.click());
        assert.deepEqual(requests, [`/api/listening/full/${id}/study`]);
        assert.equal(
          document.querySelector<HTMLInputElement>('input[maxlength="500"]')
            ?.value,
          "80",
        );
        assert.ok(document.querySelector("[role=alert]"));
        assert.equal(button.disabled, false);
      },
    );
  } finally {
    globalThis.fetch = original;
    sessionStorage.clear();
  }
});

test("Same study content before exam submission: plain text, no word targets, no popup, no lookup request", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return new Response("{}", { status: 503 }); };
  try {
    await mount(
      React.createElement(FullListeningStudy, {
        id, userId: "qa-study", title: "Study", audioUrl: "/canonical.mp3", imageUrl: null,
        questions: [{ number: 1, section: 1, text: "Weekly rent", instruction: "One word", options: [] }],
        sections: [{ number: 1, title: "Rent", transcript: "Weekly rent is eighty." }],
        occurrences: { 1: [{ id: "occ-rent", startChar: 7, endChar: 11, surfaceForm: "rent" }] },
        dict: en,
        lexicalAssistance: false,
      }),
      async () => {
        assert.ok(document.body.textContent?.includes("Weekly rent is eighty."), "the text itself is still readable");
        assert.equal(document.querySelector("[data-clickable-text]"), null);
        assert.equal(document.querySelector("[data-word],[data-token]"), null, "no vocabulary click target, cursor or highlight");
        assert.ok(document.querySelector("[data-plain-text]"));
        assert.equal(document.querySelector("[data-word-popover]"), null);
        assert.equal(calls, 0);
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("Vocabulary Session shows the CANONICAL sense, not a conflicting package definition, and saves by sense id", async () => {
  const posted: Record<string, unknown>[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    if (url === "/api/vocabulary/folders") return new Response(JSON.stringify({ folders: [{ id: "44444444-4444-4444-8444-444444444444", name: "My words" }] }), { headers: { "Content-Type": "application/json" } });
    posted.push(JSON.parse(String(options.body)));
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await mount(
      React.createElement(FullListeningActivity, {
        id, userId: "qa-user", title: "Session", activity: 5, audioUrl: null, initial: {}, dict: en,
        data: { vocabulary: [{
          senseId: "22222222-2222-4222-8222-222222222222", occurrenceId: "33333333-3333-4333-8333-333333333333",
          term: "bank", partOfSpeech: "noun", definitionEn: "CANONICAL: land beside a river", translationUz: "qirg'oq",
          lexicalType: "word", ipa: null, example: "They sat on the river bank.", also: [],
          quiz: { q: "Meaning?", options: ["river side", "money"], correct: 0 },
        }] },
      }),
      async () => {
        assert.ok(document.body.textContent?.includes("CANONICAL: land beside a river"));
        assert.equal(document.querySelector("[data-session-sense]")?.getAttribute("data-session-sense"), "22222222-2222-4222-8222-222222222222");
        assert.equal(document.querySelector("[data-clickable-text]"), null, "the session is its own study surface, not the transcript popup");
        await act(async () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("+ Vocabulary"))!.click());
        assert.equal(posted.length, 0, "opening the chooser does not save yet");
        const chooser = document.querySelector("[data-listening-vocabulary-folder]")!;
        assert.ok(chooser);
        const select = chooser.querySelector("select")!;
        await act(async () => { select.value = "44444444-4444-4444-8444-444444444444"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
        await act(async () => chooser.querySelector("button")!.click());
        assert.equal(posted[0]?.folderId, "44444444-4444-4444-8444-444444444444");
        assert.equal(posted[0]?.sessionSenseId, "22222222-2222-4222-8222-222222222222");
        assert.equal((posted[0]?.items as { definitionEn?: string }[])[0]?.definitionEn, undefined, "no local definition is sent as truth");
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});
