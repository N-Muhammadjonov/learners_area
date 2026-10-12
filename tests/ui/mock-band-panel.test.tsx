import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MockBandPanel } from "../../src/components/progress/MockBandPanel";
import { summarizeMocks } from "../../src/lib/progress/mock-summary";
test("Empty band panel keeps scale and honest empty state without fictional points", () => {
 const html=renderToStaticMarkup(React.createElement(MockBandPanel,{summary:summarizeMocks([],[]),uz:false}));
 assert.ok(html.includes("No graded full mock results yet"));assert.ok(html.includes("9.0"));assert.equal(html.includes("<circle"),false);assert.equal(html.includes("<polyline"),false);
});
test("Actual completed mocks produce a line, accessible table and improvement stats", () => {
 const summary=summarizeMocks([1,2].map(n=>({id:String(n),mockTestId:String(n),skill:"full",title:`Test ${n}`,finishedAt:new Date(Date.UTC(2026,9,n)),estimatedBand:n+5})),["1","2"]);
 const html=renderToStaticMarkup(React.createElement(MockBandPanel,{summary,uz:false}));
 assert.ok(html.includes("<polyline"));assert.equal((html.match(/<circle/g)??[]).length,2);assert.ok(html.includes("Show as table"));assert.ok(html.includes("+1.0"));
});
