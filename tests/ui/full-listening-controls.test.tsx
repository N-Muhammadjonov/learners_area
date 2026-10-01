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
              word: "keen",
              pos: "adjective",
              uz: "ishtiyoqli",
              def: "very interested",
              ex: "I am keen.",
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
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("Library search and category filters operate locally without reloading or fetching audio", async () => {
  await mount(
    React.createElement(FullListeningLibrary, {
      cards: [
        {
          id,
          title: "Full Listening 10",
          duration: 1645,
          completed: 2,
          started: true,
        },
      ],
    }),
    async () => {
      assert.equal(document.querySelector("audio"), null);
      assert.ok(document.body.textContent?.includes("2 / 5 completed"));
      await act(async () =>
        Array.from(document.querySelectorAll("button"))
          .find((b) => b.textContent?.includes("Section 1"))!
          .click(),
      );
      assert.equal(document.querySelectorAll("article").length, 0);
      assert.ok(document.body.textContent?.includes("independently published"));
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
            text: "Weekly rent",
            instruction: "One word",
            options: [],
          },
        ],
        sections: [
          { number: 1, title: "Rent", transcript: "Weekly rent is eighty." },
        ],
        dict: en,
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
            text: "Weekly rent",
            instruction: "One word",
            options: [],
          },
        ],
        sections: [],
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
