import assert from "node:assert/strict";
import test from "node:test";
import { defaultHomepageLayout, homepageSectionsValid } from "./homepage-layout.ts";

test("homepage contains each section once and permits reordering", () => {
  assert.equal(homepageSectionsValid(defaultHomepageLayout.sections), true);
  assert.equal(homepageSectionsValid([...defaultHomepageLayout.sections].reverse()), true);
  assert.equal(homepageSectionsValid(defaultHomepageLayout.sections.slice(1)), false);
  assert.equal(homepageSectionsValid(defaultHomepageLayout.sections.map(() => defaultHomepageLayout.sections[0])), false);
  assert.equal(homepageSectionsValid(defaultHomepageLayout.sections.map(section => ({ ...section, enabled: false }))), false);
});
